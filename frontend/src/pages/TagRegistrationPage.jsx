import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Navbar from '../components/Navbar.jsx';
import { fetchControllers, fetchCards, createCard, fetchCompanies, WS_URL } from '../api/index.js';

const VEHICLE_TYPES = ['2W', '4W', 'LMV', 'HMV', 'Other'];
// Access-privilege levels accepted by the controller SDK / card_type_enum.
const CARD_TYPES    = ['Normal', 'FirstCard', 'AlwaysOpen', 'Patrol', 'AntiTheft'];
const BLOOD_GROUPS  = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

function emptyForm() {
  return {
    cardNo: '', personName: '', personCode: '', company: '',
    vehicleNumber: '', vehicleType: '', vehicleBrand: '', vehicleColor: '',
    cardType: 'Normal', bloodGroup: '', validFrom: '', validUntil: '', notes: '',
    photoUrl: '', photoData: '',
  };
}

// Downscale a locally-picked image to a small JPEG data URI so the base64 payload
// stays well under the API body limit. Returns a Promise<string> (data: URI).
function compressImageFile(file, maxDim = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > maxDim)            { width  = Math.round(width  * maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function TagRegistrationPage({ dark, setDark, onNavigate, onLogout, activePage = 'tags', role = 'admin' }) {
  const [readerSn, setReaderSn]   = useState('');     // selected controller serial; '' = any reader
  const [listening, setListening] = useState(true);   // capture scans into the card field
  const [form, setForm]           = useState(emptyForm());
  const [lastScan, setLastScan]   = useState(null);    // { card_no, controller_sn, at }
  const [existing, setExisting]   = useState(null);    // existing card if scanned tag already registered
  const [saving, setSaving]       = useState(false);
  const [status, setStatus]       = useState(null);    // { type:'success'|'error', msg }
  const [photoMode, setPhotoMode] = useState('url');   // 'url' | 'upload'
  const [photoBusy, setPhotoBusy] = useState(false);   // compressing a local file
  const fileInputRef = useRef(null);

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const listeningRef = useRef(listening);
  const readerRef = useRef(readerSn);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  useEffect(() => { readerRef.current = readerSn; }, [readerSn]);

  // Controllers (readers) for the dropdown
  const { data: controllersData } = useQuery({
    queryKey: ['controllers-readers'],
    queryFn: () => fetchControllers({ limit: 200 }),
    refetchInterval: 30000,
  });
  const controllers = controllersData?.data ?? [];

  // Companies for the dropdown (registered via Configuration → Company Registration)
  const { data: companiesData } = useQuery({
    queryKey: ['companies-list'],
    queryFn: fetchCompanies,
    staleTime: 30000,
  });
  const companies = companiesData?.data ?? [];

  // ── Live scan capture over WebSocket ────────────────────────────────────────
  useEffect(() => {
    function connect() {
      if (!WS_URL) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload?.type !== 'bridge_event') return;
            const d = payload.data || {};
            const cardNo = String(d.card_no || d.cardNo || '').trim();
            if (!cardNo) return;
            // Filter by selected reader (if one is chosen)
            const sn = String(d.controller_sn || d.controllerSn || '');
            if (readerRef.current && sn && sn !== readerRef.current) return;
            if (!listeningRef.current) return;
            setLastScan({ card_no: cardNo, controller_sn: sn, at: new Date().toISOString() });
            setForm((p) => ({ ...p, cardNo }));
            checkExisting(cardNo);
          } catch (_) { /* ignore */ }
        };
        ws.onclose = () => { reconnectRef.current = setTimeout(connect, 5000); };
      } catch (_) {
        reconnectRef.current = setTimeout(connect, 5000);
      }
    }
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // When a card number appears, check whether it is already registered
  async function checkExisting(cardNo) {
    try {
      const res = await fetchCards({ search: cardNo, limit: 10 });
      const match = (res?.data ?? []).find(
        (c) => String(c.card_no).toLowerCase() === String(cardNo).toLowerCase()
      );
      setExisting(match || null);
    } catch (_) { setExisting(null); }
  }

  const selectedReaderLabel = useMemo(() => {
    if (!readerSn) return 'Any reader';
    const c = controllers.find((x) => x.sn === readerSn);
    return c ? (c.location_label || c.sn) : readerSn;
  }, [readerSn, controllers]);

  function resetForm() {
    setForm(emptyForm());
    setExisting(null);
    setLastScan(null);
    setStatus(null);
    setPhotoMode('url');
  }

  async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus({ type: 'error', msg: 'Please choose an image file (JPG, PNG, etc.).' });
      return;
    }
    setPhotoBusy(true);
    setStatus(null);
    try {
      const dataUri = await compressImageFile(file);
      // Local upload wins over a link — clear the URL so we don't store both.
      setForm((p) => ({ ...p, photoData: dataUri, photoUrl: '' }));
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Could not process that image.' });
    } finally {
      setPhotoBusy(false);
    }
  }

  function clearPhoto() {
    setForm((p) => ({ ...p, photoUrl: '', photoData: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // What to show in the preview: a local upload (data URI) or the typed link.
  const photoPreviewSrc = form.photoData || (form.photoUrl.trim() ? form.photoUrl.trim() : '');

  async function handleRegister(e) {
    e.preventDefault();
    setStatus(null);
    if (!form.cardNo.trim()) { setStatus({ type: 'error', msg: 'Scan a tag or enter a Card ID first.' }); return; }
    if (existing)            { setStatus({ type: 'error', msg: `Card ${form.cardNo} is already registered to ${existing.person_name || 'a user'}.` }); return; }

    setSaving(true);
    try {
      await createCard({
        cardNo:        form.cardNo.trim(),
        personName:    form.personName.trim()    || null,
        personCode:    form.personCode.trim()    || null,
        department:    form.company              || null,   // UI "Company" → stored in department
        vehicleNumber: form.vehicleNumber.trim() || null,
        vehicleType:   form.vehicleType          || null,
        vehicleBrand:  form.vehicleBrand.trim()  || null,
        vehicleColor:  form.vehicleColor.trim()  || null,
        cardType:      form.cardType,
        cardStatus:    'Active',
        bloodGroup:    form.bloodGroup           || null,
        validFrom:     form.validFrom            || null,
        validUntil:    form.validUntil           || null,
        notes:         form.notes.trim()         || null,
        photoUrl:      form.photoUrl.trim()      || null,
        photoData:     form.photoData            || null,
      });
      setStatus({ type: 'success', msg: `Card ${form.cardNo} registered${form.personName ? ' to ' + form.personName : ''}. Future scans will show these details.` });
      setForm(emptyForm());
      setExisting(null);
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Registration failed.' });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm';
  const labelCls = 'block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar dark={dark} setDark={setDark} activePage={activePage} onNavigate={onNavigate} onLogout={onLogout} role={role} />

      <main className="flex-1 max-w-screen-lg mx-auto w-full px-4 py-5 flex flex-col gap-5">
        <div>
          <h2 className="font-display font-bold text-xl tracking-tight text-slate-900 dark:text-white">RFID Tag Registration</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Select a reader, scan a tag to capture its Card ID, fill in the holder details, and register.
          </p>
        </div>

        {/* Step 1 — Reader + live scan */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px]">
              <label className={labelCls}>1. Select Reader</label>
              <select value={readerSn} onChange={(e) => setReaderSn(e.target.value)} className={inputCls}>
                <option value="">Any reader</option>
                {controllers.map((c) => (
                  <option key={c.id} value={c.sn}>{c.location_label || c.sn} ({c.sn})</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setListening((v) => !v)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${listening
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
            >
              <span className={`w-2 h-2 rounded-full ${listening ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              {listening ? 'Listening for scan' : 'Capture paused'}
            </button>
            {controllers.length === 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400">No readers configured yet — you can still enter a Card ID manually.</span>
            )}
          </div>

          {/* Scan target / Card ID */}
          <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-5 text-center">
            <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">Card ID</p>
            <input
              type="text"
              value={form.cardNo}
              onChange={(e) => { const v = e.target.value; setForm((p) => ({ ...p, cardNo: v })); if (v) checkExisting(v); else setExisting(null); }}
              placeholder="Scan a tag on the selected reader… or type the Card ID"
              className="w-full text-center text-2xl font-mono font-bold tracking-wider bg-transparent text-slate-900 dark:text-white outline-none"
            />
            <p className="text-xs text-slate-400 mt-2">
              {lastScan
                ? `Last scan: ${lastScan.card_no}${lastScan.controller_sn ? ' @ ' + lastScan.controller_sn : ''}`
                : `Waiting for a scan from: ${selectedReaderLabel}`}
            </p>
          </div>

          {/* Already-registered banner */}
          {existing && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">This tag is already registered</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                {existing.person_name || '—'} · {existing.vehicle_number || 'no vehicle'} · {existing.company_name || existing.company_code || 'no company'} · status {existing.card_status}
              </p>
            </div>
          )}
        </section>

        {/* Step 2 — Details + register */}
        <form onSubmit={handleRegister} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-4">
          <p className={labelCls}>2. Holder &amp; Vehicle Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Person Name</label>
              <input type="text" value={form.personName} onChange={(e) => setForm((p) => ({ ...p, personName: e.target.value }))} placeholder="Full name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Employee ID</label>
              <input type="text" value={form.personCode} onChange={(e) => setForm((p) => ({ ...p, personCode: e.target.value }))} placeholder="e.g. EMP1024" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Vehicle Number</label>
              <input type="text" value={form.vehicleNumber} onChange={(e) => setForm((p) => ({ ...p, vehicleNumber: e.target.value.toUpperCase() }))} placeholder="e.g. TS09AB1234" className={`${inputCls} font-mono`} />
            </div>
            <div>
              <label className={labelCls}>Vehicle Type</label>
              <select value={form.vehicleType} onChange={(e) => setForm((p) => ({ ...p, vehicleType: e.target.value }))} className={inputCls}>
                <option value="">— Select —</option>
                {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Vehicle Brand</label>
              <input type="text" value={form.vehicleBrand} onChange={(e) => setForm((p) => ({ ...p, vehicleBrand: e.target.value }))} placeholder="e.g. Honda, Maruti, Tata" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Vehicle Color</label>
              <input type="text" value={form.vehicleColor} onChange={(e) => setForm((p) => ({ ...p, vehicleColor: e.target.value }))} placeholder="e.g. White, Black, Silver" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <select value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} className={inputCls}>
                <option value="">— Select Company —</option>
                {companies.map((co) => <option key={co.id} value={co.name}>{co.name}</option>)}
              </select>
              {companies.length === 0 && (
                <p className="mt-1 text-xs text-amber-500">No companies yet — add one via Configuration → Company Registration.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Blood Group</label>
              <select value={form.bloodGroup} onChange={(e) => setForm((p) => ({ ...p, bloodGroup: e.target.value }))} className={inputCls}>
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Card Type</label>
              <select value={form.cardType} onChange={(e) => setForm((p) => ({ ...p, cardType: e.target.value }))} className={inputCls}>
                {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Valid From</label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm((p) => ({ ...p, validFrom: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Valid Until</label>
              <input type="date" value={form.validUntil} onChange={(e) => setForm((p) => ({ ...p, validUntil: e.target.value }))} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputCls} />
            </div>

            {/* ── Photograph ─────────────────────────────────────── */}
            <div className="sm:col-span-2">
              <label className={labelCls}>Photograph</label>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col sm:flex-row gap-4">
                {/* Preview */}
                <div className="flex-shrink-0 flex flex-col items-center gap-2">
                  <div className="w-28 h-28 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                    {photoPreviewSrc ? (
                      <img
                        src={photoPreviewSrc}
                        alt="Cardholder"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling && (e.currentTarget.nextSibling.style.display = 'flex'); }}
                      />
                    ) : null}
                    <div className="w-full h-full flex-col items-center justify-center text-slate-300 dark:text-slate-600" style={{ display: photoPreviewSrc ? 'none' : 'flex' }}>
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                    </div>
                  </div>
                  {photoPreviewSrc && (
                    <button type="button" onClick={clearPhoto} className="text-xs text-red-500 hover:text-red-600 font-semibold">Remove</button>
                  )}
                </div>

                {/* Controls */}
                <div className="flex-1 flex flex-col gap-2">
                  {/* mode tabs */}
                  <div className="inline-flex w-fit items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                    {[
                      { key: 'url', label: 'Image Link' },
                      { key: 'upload', label: 'Upload from Device' },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setPhotoMode(t.key)}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${photoMode === t.key
                          ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {photoMode === 'url' ? (
                    <>
                      <input
                        type="url"
                        value={form.photoUrl}
                        onChange={(e) => setForm((p) => ({ ...p, photoUrl: e.target.value, photoData: '' }))}
                        placeholder="https://example.com/photo.jpg"
                        className={inputCls}
                      />
                      <p className="text-xs text-slate-400">Paste a direct link to the image. It will be fetched and shown wherever this cardholder appears.</p>
                    </>
                  ) : (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={photoBusy}
                        className="w-fit inline-flex items-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-semibold"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                        {photoBusy ? 'Processing…' : 'Choose Image'}
                      </button>
                      <p className="text-xs text-slate-400">JPG, PNG, etc. The image is automatically resized before saving.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {status && (
            <div className={`rounded-lg px-3 py-2 text-sm ${status.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
              {status.msg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Clear
            </button>
            <button type="submit" disabled={saving || !!existing}
              className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white">
              {saving ? 'Registering…' : 'Register Tag'}
            </button>
          </div>
        </form>

        <p className="text-xs text-slate-400 dark:text-slate-500">
          Registered tags are stored in the database (cards). When this tag is scanned again at any reader, these details are shown automatically on the Live Entry/Exit and Events screens.
        </p>
      </main>
    </div>
  );
}
