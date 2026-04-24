/**
 * Admin — Gift Box Manager
 *
 * On-chain (BoxDef): box_id, amount, fee_bps, enabled  (name='', urls=[])
 * Off-chain (gift_box_meta DB): name, description, collection, image_urls[], source_url
 *
 * Flow: admin fills metadata → saves to DB → signs chain TX for financial params
 */
import { useState, useEffect, useCallback } from 'react'
import { useInterwovenKit } from '@initia/interwovenkit-react'
import { adminHeaders, adminJsonHeaders } from '../lib/adminAuth'
import { API_ORIGIN } from '../lib/config'
import {
  buildRegisterBox, buildUpdateBox, buildRemoveBox,
  buildListBox, buildDelistBox,
} from '../lib/txBuilder'

// ── Types ───────────────────────────────────────────────────────

interface BoxMeta {
  name: string
  description: string
  collection: string
  image_urls: string[]
  source_url: string
}

interface Box {
  box_id: number
  amount: number
  fee_bps: number
  enabled: boolean
  meta: BoxMeta | null
}

interface ContractConfig {
  moduleAddress: string
  giftPoolAddress: string
}

const COLLECTIONS = [
  { value: 'painting', label: 'Painting' },
  { value: 'music_box', label: 'Music Box' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'sculpture', label: 'Sculpture' },
  { value: 'textile', label: 'Textile' },
  { value: 'ceramic', label: 'Ceramic' },
  { value: 'watch', label: 'Watch' },
  { value: 'brooch', label: 'Brooch' },
  { value: 'armor', label: 'Armor' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'jewelry', label: 'Jewelry' },
  { value: 'other', label: 'Other' },
]

const COL_EMOJI: Record<string, string> = {
  painting: '🖼', music_box: '🎵', instrument: '🎸',
  sculpture: '🗿', textile: '🧵', ceramic: '🏺', watch: '⌚', brooch: '💎',
  armor: '🛡', furniture: '🪑', jewelry: '💍', other: '📦',
}

const EMPTY_FORM = {
  name: '', collection: 'painting', description: '',
  amount: '0', feeBps: '500', enabled: true, sourceUrl: '',
  featured: false, featuredSort: '0',
}

// ── Component ───────────────────────────────────────────────────

export function GiftArtworks() {
  const { address, requestTxBlock } = useInterwovenKit() as any
  const [boxes, setBoxes]     = useState<Box[]>([])
  const [config, setConfig]   = useState<ContractConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Form state
  const [mode, setMode]       = useState<'list' | 'add' | 'edit'>('list')
  const [editBox, setEditBox] = useState<Box | null>(null)
  const [form, setForm]       = useState({ ...EMPTY_FORM })
  const [saving, setSaving]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // Images: all scraped + selected
  const [scrapedImages, setScrapedImages] = useState<string[]>([])
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [scrapeUrl, setScrapeUrl]   = useState('')
  const [scraping, setScraping]     = useState(false)
  const [uploading, setUploading]   = useState(false)

  // Filter
  const [filterCol, setFilterCol] = useState('all')

  // ── Load ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [boxRes, cfgRes] = await Promise.all([
        fetch(`${API_ORIGIN}/v1/admin/gift/boxes`, { headers: adminHeaders() }),
        fetch(`${API_ORIGIN}/v1/admin/config`, { headers: adminHeaders() }),
      ])
      const boxData = await boxRes.json()
      const cfgData = await cfgRes.json()
      if (!boxRes.ok) throw new Error(boxData.error ?? 'Failed')
      setBoxes(boxData.boxes ?? [])
      setConfig(cfgData)
    } catch (e: any) { setError(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Helpers ─────────────────────────────────────────────────────

  function getName(b: Box) { return b.meta?.name || b.name || `Box #${b.box_id}` }
  function getCol(b: Box) { return b.meta?.collection || 'other' }
  function getDesc(b: Box) { return b.meta?.description || '' }
  function getImages(b: Box) { return b.meta?.image_urls || [] }
  function getThumb(b: Box) { return getImages(b)[0] || '' }

  function fmtAmount(micro: number) {
    return micro === 0 ? 'Flexible' : (micro / 1_000_000).toFixed(2) + ' iUSD'
  }
  function fmtFee(bps: number) { return (bps / 100).toFixed(2) + '%' }

  // ── URL Scraper (returns multiple images) ───────────────────────

  async function handleScrape() {
    if (!scrapeUrl.trim()) return
    setScraping(true)
    try {
      const res = await fetch(
        `${API_ORIGIN}/v1/admin/scrape-url?url=${encodeURIComponent(scrapeUrl)}`,
        { headers: adminHeaders() },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setForm(f => ({
        ...f,
        name: data.title || f.name,
        description: data.description || f.description,
        sourceUrl: scrapeUrl,
      }))
      const rawImgs = data.images || (data.image ? [data.image] : [])
      // Import scraped images to local CDN
      const boxId = mode === 'add'
        ? (boxes.length > 0 ? Math.max(...boxes.map(b => b.box_id)) + 1 : 1)
        : editBox?.box_id ?? 0
      const localImgs: string[] = []
      for (let i = 0; i < rawImgs.length && i < 5; i++) {
        try {
          const impRes = await fetch(`${API_ORIGIN}/v1/admin/import-image`, {
            method: 'POST', headers: adminJsonHeaders(),
            body: JSON.stringify({ url: rawImgs[i], boxId, index: i }),
          })
          const impData = await impRes.json()
          localImgs.push(impRes.ok ? impData.url : rawImgs[i])
        } catch { localImgs.push(rawImgs[i]) }
      }
      setScrapedImages(localImgs)
      setSelectedImages(localImgs)
    } catch (e: any) { alert('Scrape failed: ' + e.message) }
    setScraping(false)
  }

  function toggleImage(url: string) {
    setSelectedImages(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]
    )
  }

  // ── Image Upload ────────────────────────────────────────────────

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await fetch(`${API_ORIGIN}/v1/admin/upload`, {
        method: 'POST',
        headers: adminJsonHeaders(),
        body: JSON.stringify({ data: dataUrl, filename: file.name.replace(/\.[^.]+$/, '') }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setScrapedImages(prev => [data.url, ...prev])
      setSelectedImages(prev => [data.url, ...prev])
    } catch (e: any) { alert('Upload failed: ' + e.message) }
    setUploading(false)
  }

  // ── TX Signing ──────────────────────────────────────────────────

  async function signTx(msg: any) {
    if (!requestTxBlock) throw new Error('Wallet not connected')
    const res = await requestTxBlock({ messages: [msg] })
    if (res && (res as any).code !== 0 && (res as any).code !== undefined) {
      throw new Error((res as any).rawLog ?? 'Transaction failed')
    }
  }

  // ── Save: DB metadata + chain TX ────────────────────────────────

  /** Save metadata to DB only (no chain TX) */
  async function handleSaveMeta() {
    setSaving(true); setSaveErr(null)
    try {
      const boxId = mode === 'add'
        ? (boxes.length > 0 ? Math.max(...boxes.map(b => b.box_id)) + 1 : 1)
        : editBox!.box_id
      const res = await fetch(`${API_ORIGIN}/v1/admin/gift/meta/${boxId}`, {
        method: 'PUT',
        headers: adminJsonHeaders(),
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          collection: form.collection,
          image_urls: selectedImages,
          source_url: form.sourceUrl,
          featured: form.featured,
          featured_sort: parseInt(form.featuredSort) || 0,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setMode('list'); load()
    } catch (e: any) { setSaveErr(e.message) }
    setSaving(false)
  }

  /** Save metadata to DB + sign chain TX */
  async function handleSaveAll() {
    if (!config || !address) { setSaveErr('Connect wallet first'); return }
    setSaving(true); setSaveErr(null)
    try {
      const boxId = mode === 'add'
        ? (boxes.length > 0 ? Math.max(...boxes.map(b => b.box_id)) + 1 : 1)
        : editBox!.box_id
      const amountMicro = BigInt(Math.round(parseFloat(form.amount || '0') * 1_000_000))
      const feeBps = BigInt(parseInt(form.feeBps) || 500)

      // 1. Save metadata to DB
      await fetch(`${API_ORIGIN}/v1/admin/gift/meta/${boxId}`, {
        method: 'PUT',
        headers: adminJsonHeaders(),
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          collection: form.collection,
          image_urls: selectedImages,
          source_url: form.sourceUrl,
          featured: form.featured,
          featured_sort: parseInt(form.featuredSort) || 0,
        }),
      })

      // 2. Sign chain TX (minimal: id, amount, fee, enabled)
      if (mode === 'add') {
        const msg = buildRegisterBox(
          address, config.moduleAddress, config.giftPoolAddress,
          BigInt(boxId), amountMicro, feeBps, form.enabled,
        )
        await signTx(msg)
      } else {
        const msg = buildUpdateBox(
          address, config.moduleAddress, config.giftPoolAddress,
          BigInt(boxId), amountMicro, feeBps, form.enabled,
        )
        await signTx(msg)
      }

      setMode('list'); load()
    } catch (e: any) { setSaveErr(e.message) }
    setSaving(false)
  }

  async function handleToggle(box: Box) {
    if (!config || !address) return
    try {
      const msg = box.enabled
        ? buildDelistBox(address, config.moduleAddress, config.giftPoolAddress, BigInt(box.box_id))
        : buildListBox(address, config.moduleAddress, config.giftPoolAddress, BigInt(box.box_id))
      await signTx(msg)
      load()
    } catch (e: any) { alert('Failed: ' + e.message) }
  }

  async function handleDelete(box: Box) {
    if (!config || !address) return
    const name = getName(box)
    if (!confirm(`⚠️ DELETE box #${box.box_id} "${name}"?\nThis removes it from the BLOCKCHAIN. Irreversible.`)) return
    if (!confirm(`FINAL WARNING: Permanently delete box #${box.box_id}?`)) return
    try {
      const msg = buildRemoveBox(address, config.moduleAddress, config.giftPoolAddress, BigInt(box.box_id))
      await signTx(msg)
      // Also clean DB metadata
      await fetch(`${API_ORIGIN}/v1/admin/gift/meta/${box.box_id}`, {
        method: 'DELETE', headers: adminHeaders(),
      })
      load()
    } catch (e: any) { alert('Delete failed: ' + e.message) }
  }

  // ── Start edit/add ──────────────────────────────────────────────

  function startEdit(box: Box) {
    setEditBox(box)
    const imgs = getImages(box)
    setForm({
      name: getName(box),
      collection: getCol(box),
      description: getDesc(box),
      amount: (box.amount / 1_000_000).toString(),
      feeBps: String(box.fee_bps),
      enabled: box.enabled,
      sourceUrl: box.meta?.source_url || '',
      featured: box.meta?.featured === true || box.meta?.featured === 1,
      featuredSort: String(box.meta?.featured_sort ?? 0),
    })
    setScrapedImages(imgs)
    setSelectedImages(imgs)
    setSaveErr(null)
    setMode('edit')
  }

  function startAdd() {
    setEditBox(null)
    setForm({ ...EMPTY_FORM })
    setScrapedImages([])
    setSelectedImages([])
    setSaveErr(null)
    setMode('add')
  }

  // ── Filter ──────────────────────────────────────────────────────

  const filtered = filterCol === 'all' ? boxes : boxes.filter(b => getCol(b) === filterCol)

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, color: '#e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🎁 Gift Boxes</h2>
        <span style={{ fontSize: 12, color: '#64748b' }}>{boxes.length} on chain</span>
        {mode === 'list' && (
          <button onClick={startAdd} style={greenBtn}>+ New Box</button>
        )}
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>⚠ {error}</div>}
      {loading && <div style={{ color: '#64748b' }}>Loading from chain…</div>}
      {!address && (
        <div style={{ ...warnBox, marginBottom: 16 }}>
          ⚠ Connect your admin wallet to sign transactions.
        </div>
      )}

      {/* ── Form ───────────────────────────────────────────────── */}
      {(mode === 'add' || mode === 'edit') && (
        <div style={formPanel}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: '#94a3b8' }}>
            {mode === 'add' ? 'REGISTER NEW BOX' : `EDIT BOX #${editBox?.box_id}`}
          </div>

          {/* Chain status */}
          {mode === 'edit' && editBox && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8,
                          background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}>
              <span style={{ color: '#64748b' }}>On-chain: </span>
              <span style={{ color: '#e2e8f0' }}>
                ID #{editBox.box_id} · Amount: {editBox.amount === 0 ? 'Flexible' : (editBox.amount / 1_000_000).toFixed(2) + ' iUSD'}
                {' '}· Fee: {(editBox.fee_bps / 100).toFixed(2)}% · {editBox.enabled ? '✅ Listed' : '❌ Delisted'}
              </span>
              {!editBox.meta && (
                <span style={{ color: '#f59e0b', marginLeft: 8 }}>
                  — No metadata yet. Fill in the form below and save.
                </span>
              )}
            </div>
          )}

          {/* URL Scanner */}
          <div style={scannerBox}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 700 }}>
              🔗 SCAN URL (auto-fill name, description, images)
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="text" placeholder="https://www.metmuseum.org/art/collection/search/505661"
                value={scrapeUrl} onChange={e => setScrapeUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScrape()}
                style={{ ...inputStyle, flex: 1, fontSize: 12, fontFamily: 'monospace' }} />
              <button onClick={handleScrape} disabled={scraping || !scrapeUrl.trim()}
                style={{ ...purpleBtn, opacity: scraping || !scrapeUrl.trim() ? 0.5 : 1 }}>
                {scraping ? '⏳' : 'Scan'}
              </button>
            </div>
          </div>

          {/* Fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name" value={form.name}
              onChange={v => setForm(f => ({ ...f, name: v }))} />
            <div>
              <div style={labelStyle}>COLLECTION</div>
              <select value={form.collection}
                onChange={e => setForm(f => ({ ...f, collection: e.target.value }))}
                style={{ ...inputStyle, width: '100%' }}>
                {COLLECTIONS.map(c => (
                  <option key={c.value} value={c.value}>{COL_EMOJI[c.value]} {c.label}</option>
                ))}
              </select>
            </div>
            <Field label="Amount (iUSD, 0 = flexible)" value={form.amount}
              onChange={v => setForm(f => ({ ...f, amount: v }))} type="number" />
            <Field label="Fee (basis points, 500 = 5%)" value={form.feeBps}
              onChange={v => setForm(f => ({ ...f, feeBps: v }))} type="number" />
            <div>
              <div style={labelStyle}>ENABLED</div>
              <select value={form.enabled ? 'yes' : 'no'}
                onChange={e => setForm(f => ({ ...f, enabled: e.target.value === 'yes' }))}
                style={{ ...inputStyle, width: '100%' }}>
                <option value="yes">✅ Listed</option>
                <option value="no">❌ Delisted</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Description" value={form.description}
                onChange={v => setForm(f => ({ ...f, description: v }))} />
            </div>

            {/* Featured toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.featured}
                  onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: '#d4a017' }} />
                <span style={{ fontWeight: 600 }}>⭐ Featured</span>
              </label>
              {form.featured && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  Sort:
                  <input type="number" value={form.featuredSort}
                    onChange={e => setForm(f => ({ ...f, featuredSort: e.target.value }))}
                    style={{ width: 50, padding: '2px 6px', borderRadius: 4, border: '1px solid #444', background: '#1a1a2e', color: '#fff', fontSize: 12 }} />
                </label>
              )}
            </div>
          </div>

          {/* Amount hint */}
          {parseFloat(form.amount) === 0 && (
            <div style={hintBox}>
              Flexible: users send 0.1–1000 iUSD. Fee {(parseInt(form.feeBps) / 100).toFixed(2)}% (max 50 iUSD).
            </div>
          )}

          {/* ── Image Gallery ──────────────────────────────────── */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={labelStyle}>IMAGES ({selectedImages.length} selected)</div>
              <label style={{ ...purpleBtn, fontSize: 11, padding: '4px 10px', opacity: uploading ? 0.5 : 1 }}>
                {uploading ? '⏳' : '📁 Upload'}
                <input type="file" accept="image/*" onChange={handleImageUpload}
                  style={{ display: 'none' }} disabled={uploading} />
              </label>
            </div>

            {scrapedImages.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {scrapedImages.map((url, i) => {
                  const sel = selectedImages.includes(url)
                  return (
                    <div key={i} onClick={() => toggleImage(url)} style={{
                      position: 'relative', cursor: 'pointer',
                      border: sel ? '2px solid #3b82f6' : '2px solid #334155',
                      borderRadius: 8, overflow: 'hidden', width: 120, height: 90,
                    }}>
                      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => (e.currentTarget.style.display = 'none')} />
                      {sel && (
                        <div style={{ position: 'absolute', top: 4, right: 4, background: '#3b82f6',
                                      borderRadius: '50%', width: 20, height: 20, display: 'flex',
                                      alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                          ✓
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {scrapedImages.length === 0 && (
              <div style={{ fontSize: 11, color: '#475569' }}>
                Scan a URL or upload images. Click to select/deselect.
              </div>
            )}
          </div>

          {saveErr && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>⚠ {saveErr}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {mode === 'edit' && (
              <button onClick={handleSaveMeta} disabled={saving} style={{
                ...greenBtnStyle, opacity: saving ? 0.5 : 1,
              }}>
                {saving ? 'Saving…' : '💾 Save Metadata Only'}
              </button>
            )}
            <button onClick={handleSaveAll} disabled={saving || !address} style={{
              ...blueBtn, opacity: saving || !address ? 0.5 : 1,
            }}>
              {saving ? 'Signing TX…' : mode === 'add' ? '📝 Save Meta + Register on Chain' : '📝 Save Meta + Update Chain'}
            </button>
            <button onClick={() => setMode('list')} style={cancelBtn}>Cancel</button>
          </div>

          <div style={{ fontSize: 10, color: '#475569', marginTop: 8 }}>
            💾 Save Metadata Only = name/desc/images → DB (no wallet needed) &nbsp;|&nbsp;
            📝 Save + Chain = DB + sign TX for amount/fee/enabled
          </div>
        </div>
      )}

      {/* ── Collection Filter ──────────────────────────────────── */}
      {mode === 'list' && !loading && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <FilterChip label="All" value="all" current={filterCol} onClick={setFilterCol} count={boxes.length} />
          {COLLECTIONS.map(c => {
            const count = boxes.filter(b => getCol(b) === c.value).length
            if (!count) return null
            return <FilterChip key={c.value} label={`${COL_EMOJI[c.value]} ${c.label}`}
              value={c.value} current={filterCol} onClick={setFilterCol} count={count} />
          })}
        </div>
      )}

      {/* ── Box Grid ───────────────────────────────────────────── */}
      {mode === 'list' && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {filtered.map(box => (
            <BoxCard key={box.box_id} box={box}
              getName={getName} getCol={getCol} getDesc={getDesc} getThumb={getThumb} getImages={getImages}
              fmtAmount={fmtAmount} fmtFee={fmtFee}
              onEdit={() => startEdit(box)}
              onToggle={() => handleToggle(box)}
              onDelete={() => handleDelete(box)} />
          ))}
        </div>
      )}

      {mode === 'list' && !loading && !filtered.length && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
          No boxes. Click "+ New Box" to register.
        </div>
      )}
    </div>
  )
}

// ── BoxCard with image gallery ──────────────────────────────────

function BoxCard({ box, getName, getCol, getDesc, getThumb, getImages, fmtAmount, fmtFee,
  onEdit, onToggle, onDelete }: {
  box: Box
  getName: (b: Box) => string; getCol: (b: Box) => string; getDesc: (b: Box) => string
  getThumb: (b: Box) => string; getImages: (b: Box) => string[]
  fmtAmount: (n: number) => string; fmtFee: (n: number) => string
  onEdit: () => void; onToggle: () => void; onDelete: () => void
}) {
  const [imgIdx, setImgIdx] = useState(0)
  const images = getImages(box)
  const thumb = images[imgIdx] || getThumb(box)

  return (
    <div style={{
      background: '#1e293b', borderRadius: 12, overflow: 'hidden',
      border: box.enabled ? '1px solid #334155' : '1px solid #ef444440',
      opacity: box.enabled ? 1 : 0.6,
    }}>
      {/* Image area */}
      <div style={{ position: 'relative', height: 200, background: '#0f172a' }}>
        {thumb ? (
          <img src={thumb} alt={getName(box)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 48 }}>
            {COL_EMOJI[getCol(box)] || '📦'}
          </div>
        )}
        {/* Image count badge + nav arrows */}
        {images.length > 1 && (
          <>
            <div style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
                          background: 'rgba(0,0,0,0.75)', padding: '2px 8px', borderRadius: 10,
                          fontSize: 10, color: '#94a3b8' }}>
              {imgIdx + 1} / {images.length}
            </div>
            <button onClick={e => { e.stopPropagation(); setImgIdx(i => (i - 1 + images.length) % images.length) }}
              style={arrowBtn('left')}>‹</button>
            <button onClick={e => { e.stopPropagation(); setImgIdx(i => (i + 1) % images.length) }}
              style={arrowBtn('right')}>›</button>
          </>
        )}
        {!box.enabled && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>DELISTED</span>
          </div>
        )}
        <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.75)',
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: 'white' }}>
          {fmtAmount(box.amount)}
        </div>
        <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.75)',
                      padding: '2px 8px', borderRadius: 20, fontSize: 10, color: '#94a3b8' }}>
          {COL_EMOJI[getCol(box)]} {getCol(box)}
        </div>
      </div>
      {/* Info */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>
          {getName(box)}
        </div>
        {getDesc(box) && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, lineHeight: 1.3,
                        overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
            {getDesc(box)}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#64748b' }}>
          Fee: {fmtFee(box.fee_bps)} · ID: {box.box_id}
          {images.length > 1 && ` · ${images.length} images`}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={onEdit} style={btnSmall('#3b82f6')}>Edit</button>
          <button onClick={onToggle} style={btnSmall(box.enabled ? '#f59e0b' : '#22c55e')}>
            {box.enabled ? 'Delist' : 'List'}
          </button>
          <button onClick={onDelete} style={btnSmall('#ef4444')}>Delete</button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
    </div>
  )
}

function FilterChip({ label, value, current, onClick, count }: {
  label: string; value: string; current: string; onClick: (v: string) => void; count: number
}) {
  const active = current === value
  return (
    <button onClick={() => onClick(value)} style={{
      padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
      border: active ? '1px solid #3b82f6' : '1px solid #334155',
      background: active ? '#3b82f620' : 'transparent',
      color: active ? '#3b82f6' : '#94a3b8',
    }}>{label} ({count})</button>
  )
}

// ── Styles ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
  padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
}
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#64748b', marginBottom: 4 }
const formPanel: React.CSSProperties = {
  background: '#1e293b', borderRadius: 12, padding: 20,
  border: '1px solid #334155', marginBottom: 24,
}
const scannerBox: React.CSSProperties = {
  marginBottom: 16, padding: '12px 14px', borderRadius: 8,
  background: '#0f172a', border: '1px solid #3b4a6b',
}
const warnBox: React.CSSProperties = {
  background: '#1e293b', borderRadius: 8, padding: 16,
  border: '1px solid #f59e0b', color: '#f59e0b', fontSize: 13,
}
const hintBox: React.CSSProperties = {
  fontSize: 11, color: '#f59e0b', marginTop: 8, padding: '6px 10px',
  background: '#f59e0b15', borderRadius: 6,
}
const greenBtn: React.CSSProperties = {
  marginLeft: 'auto', background: '#22c55e', color: '#fff', border: 'none',
  borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const purpleBtn: React.CSSProperties = {
  padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: '#6366f1', color: 'white', fontSize: 12, fontWeight: 700,
}
const greenBtnStyle: React.CSSProperties = {
  background: '#22c55e', color: '#fff', border: 'none',
  borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const blueBtn: React.CSSProperties = {
  background: '#3b82f6', color: '#fff', border: 'none',
  borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const cancelBtn: React.CSSProperties = {
  background: 'none', color: '#64748b', border: '1px solid #334155',
  borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer',
}
const btnSmall = (bg: string): React.CSSProperties => ({
  background: bg, color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', flex: 1,
})
const arrowBtn = (side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  [side]: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none',
  borderRadius: '50%', width: 24, height: 24, fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
})
