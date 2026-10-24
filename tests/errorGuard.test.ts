import { describe, expect, it } from 'vitest'
import {
  BannerState,
  ContextTracker,
  ErrorLog,
  Heartbeat,
  HEARTBEAT_MS,
  loadProbes,
  SESSION_KEY,
  STORAGE_KEY,
  type GuardRecord,
  type GuardStorage,
} from '../src/ui/errorGuard'

/** 崩溃诊断加固回归：错误日志去重/上限/持久化、横幅状态机、context lost 流。 */

const rec = (kind: string, message: string, at: number): GuardRecord => ({ at, kind, message })

describe('ErrorLog 风暴去重与上限', () => {
  it('新错误入列返回 true；同错误短窗口内重复只计 count', () => {
    const log = new ErrorLog()
    expect(log.add(rec('frame', 'boom', 1000), 1000)).toBe(true)
    expect(log.add(rec('frame', 'boom', 2000), 2000)).toBe(false)
    expect(log.add(rec('frame', 'boom', 4999), 4999)).toBe(false)
    const list = log.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.count).toBe(3)
  })

  it('同错误超过去重窗口后重新入列；不同错误不受窗口约束', () => {
    const log = new ErrorLog()
    log.add(rec('frame', 'boom', 1000), 1000)
    expect(log.add(rec('frame', 'boom', 1000 + 5001), 1000 + 5001)).toBe(true)
    expect(log.add(rec('render', 'other', 1000 + 5002), 1000 + 5002)).toBe(true)
    expect(log.list()).toHaveLength(3)
  })

  it('环形上限 10 条：旧记录被丢弃', () => {
    const log = new ErrorLog()
    for (let i = 0; i < 12; i++) log.add(rec('frame', `e${i}`, i * 10_000), i * 10_000)
    const list = log.list()
    expect(list).toHaveLength(10)
    expect(list[0]?.message).toBe('e2')
    expect(list[9]?.message).toBe('e11')
  })

  it('序列化往返 + 容错加载', () => {
    const log = new ErrorLog()
    log.add(rec('frame', 'boom', 1000))
    log.add(rec('frame', 'boom', 1500)) // count=2
    log.add(rec('boot', 'webgl 不可用', 9000))
    const json = log.toJSON()
    const restored = ErrorLog.load(json)
    expect(restored).toHaveLength(2)
    expect(restored[0]?.count).toBe(2)
    expect(restored[1]?.message).toBe('webgl 不可用')
    // 容错
    expect(ErrorLog.load(null)).toEqual([])
    expect(ErrorLog.load('not json{')).toEqual([])
    expect(ErrorLog.load('{"a":1}')).toEqual([])
    expect(ErrorLog.load('[1,null,{"kind":"x"}]')).toEqual([]) // 缺 message 的条目跳过
  })
})

describe('BannerState 横幅状态机', () => {
  it('hidden → report → shown；dismiss 后同错误不再拉起，新错误重新拉起', () => {
    const b = new BannerState()
    expect(b.phase).toBe('hidden')
    expect(b.report('frame', 'boom', 1)).toBe(true)
    expect(b.phase).toBe('shown')
    b.dismiss()
    expect(b.phase).toBe('dismissed')
    expect(b.report('frame', 'boom', 2)).toBe(false) // 同错误保持关闭
    expect(b.phase).toBe('dismissed')
    expect(b.report('render', 'other', 1)).toBe(true) // 新错误重新拉起
    expect(b.phase).toBe('shown')
  })

  it('hide 仅从 shown 收起；ctxlost 信息条用完即收后可再次显示', () => {
    const b = new BannerState()
    b.hide()
    expect(b.phase).toBe('hidden')
    b.report('ctxlost', '恢复中', 1)
    b.hide()
    expect(b.phase).toBe('hidden')
    expect(b.report('ctxlost', '恢复中', 1)).toBe(true)
  })

  it('dismiss 后 hide 不越权（dismissed 不被 hide 改写）', () => {
    const b = new BannerState()
    b.report('frame', 'a', 1)
    b.dismiss()
    b.hide()
    expect(b.phase).toBe('dismissed')
  })
})

describe('ContextTracker 上下文丢失流', () => {
  it('lost → 超时窗口内 restored ⇒ 恢复', () => {
    const c = new ContextTracker()
    c.lost(1000)
    expect(c.phase).toBe('lost')
    expect(c.expired(1000 + 7999)).toBe(false)
    expect(c.restored()).toBe(true)
    expect(c.phase).toBe('restored')
    expect(c.expired(99999)).toBe(false) // 已恢复不再判死
  })

  it('lost → 超时未恢复 ⇒ dead（建议刷新）', () => {
    const c = new ContextTracker()
    c.lost(1000)
    expect(c.expired(1000 + 8000)).toBe(true)
    expect(c.phase).toBe('dead')
    expect(c.expired(1000 + 9000)).toBe(false)
  })

  it('未 lost 时 restored 返回 false（幂等安全）', () => {
    const c = new ContextTracker()
    expect(c.restored()).toBe(false)
    expect(c.phase).toBe('ok')
  })
})

describe('STORAGE_KEY 契约', () => {
  it('持久化键名固定为 hsr:lasterror（真机排查文档引用）', () => {
    expect(STORAGE_KEY).toBe('hsr:lasterror')
  })
})

describe('Heartbeat 崩溃取证心跳', () => {
  const mem = (init: Record<string, string> = {}): GuardStorage & { data: Record<string, string> } => {
    const s = {
      data: init,
      getItem(k: string) {
        return s.data[k] ?? null
      },
      setItem(k: string, v: string) {
        s.data[k] = v
      },
    }
    return s
  }

  it('窗口内节流跳过；窗口外落盘并带探测值', () => {
    const s = mem()
    const hb = new Heartbeat(() => ({ heapMB: 18.4, tier: 'low' }), s)
    expect(hb.tick(1000)).toBe(true) // 首次立即写
    expect(hb.tick(1000 + 10_000)).toBe(false) // 窗口内
    expect(hb.tick(1000 + HEARTBEAT_MS)).toBe(true)
    const probes = loadProbes(s.data[SESSION_KEY] ?? null)
    expect(probes).toHaveLength(2)
    expect(probes[1]?.heapMB).toBe(18.4)
    expect(probes[1]?.tier).toBe('low')
  })

  it('环形上限 8 条：旧心跳被丢弃（崩溃轨迹只留最近）', () => {
    const s = mem()
    const hb = new Heartbeat(() => ({ heapMB: 1, tier: 'high' }), s)
    for (let i = 0; i < 10; i++) hb.tick(i * HEARTBEAT_MS)
    const probes = loadProbes(s.data[SESSION_KEY] ?? null)
    expect(probes).toHaveLength(8)
  })

  it('heapMB 不可用时记 null（不抛、不留空档）', () => {
    const s = mem()
    const hb = new Heartbeat(() => ({ heapMB: null, tier: 'mid' }), s)
    hb.tick(0)
    expect(loadProbes(s.data[SESSION_KEY] ?? null)[0]?.heapMB).toBeNull()
  })

  it('loadProbes 容错：损坏 JSON / 非数组 / 缺 tier → []', () => {
    expect(loadProbes(null)).toEqual([])
    expect(loadProbes('not json')).toEqual([])
    expect(loadProbes('{"a":1}')).toEqual([])
    expect(loadProbes('[{"at":1,"heapMB":2}]')).toEqual([]) // 缺 tier
    expect(loadProbes('[{"at":1,"heapMB":2,"tier":"low"},null,{"at":2,"tier":"high"}]')).toHaveLength(2)
  })
})
