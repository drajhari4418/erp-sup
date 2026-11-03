// Maps the app's data calls (DB / U) onto real Supabase tables, one per ERP module.
// Types: t=text, n=number, d=date, j=json. Empty strings are stored as NULL and read back as "".
const mk = (t, c) => ({ t, c: { ...c, by: 't' } });
const SCHEMA = {
  rec_so:      mk('sales_orders',     { customer: 't', pono: 't', item: 't', qty: 'n', date: 'd', due: 'd', status: 't' }),
  rec_wo:      mk('work_orders',      { so: 't', item: 't', qty: 'n', start: 'd', due: 'd', status: 't' }),
  rec_ind:     mk('indents',          { wo: 't', item: 't', qty: 'n', req: 'd', status: 't' }),
  rec_po:      mk('purchase_orders',  { ind: 't', vendor: 't', item: 't', qty: 'n', rate: 'n', gst: 't', date: 'd' }),
  rec_grn:     mk('grns',             { po: 't', item: 't', qty: 'n', heat: 't', date: 'd' }),
  rec_fgr:     mk('fg_receipts',      { wo: 't', item: 't', qty: 'n', rej: 'n', date: 'd' }),
  rec_spectro: mk('spectro_reports',  { wo: 't', sample: 't', heat: 't', date: 'd', comp: 'j', result: 't' }),
  rec_mtc:     mk('mtcs',             { wo: 't', spectro: 't', customer: 't', heat: 't', qty: 'n', date: 'd' }),
  rec_dn:      mk('dispatch_notes',   { so: 't', item: 't', qty: 'n', date: 'd', vehicle: 't', eway: 't' }),
  rec_inv:     mk('invoices',         { dn: 't', customer: 't', amount: 'n', gst: 't', date: 'd' }),
  access:      { t: 'module_access',   id: 'user_id', c: { perms: 'j', label: 't' } },
  requests:    { t: 'access_requests', id: 'user_id', c: { at: 'n' } }
};
const COL = { by: 'created_by', at: 'requested_at' };
const col = k => COL[k] || k;

function toRow(s, o, id) {
  const r = { [s.id || 'id']: id };
  for (const k in s.c) {
    let v = o[k];
    if (s.c[k] !== 'j') v = (v === '' || v === undefined || v === null) ? null : s.c[k] === 'n' ? Number(v) : v;
    else if (v === undefined) v = null;
    r[col(k)] = v;
  }
  return r;
}
function fromRow(s, r) {
  const o = { id: r[s.id || 'id'] };
  for (const k in s.c) { const v = r[col(k)]; o[k] = v === null && s.c[k] !== 'j' ? '' : v; }
  return o;
}

function makeDB(sb) {
  const parse = p => { const i = p.indexOf('/'); const s = SCHEMA[p.slice(0, i)]; if (!s) throw new Error('Unknown collection ' + p); return [s, p.slice(i + 1)]; };
  const wrap = (s, r) => { const o = fromRow(s, r); return { id: o.id, exists: true, data: () => o }; };
  const watch = (name, table, filter, load) => {
    load();
    const ch = sb.channel(name + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, load).subscribe();
    return () => sb.removeChannel(ch);
  };
  const list = async (s, f, v) => {
    let q = sb.from(s.t).select('*');
    if (f) q = q.eq(col(f), v);
    const { data, error } = await q; if (error) throw error;
    return { docs: data.map(r => wrap(s, r)) };
  };
  return {
    doc: p => {
      const [s, id] = parse(p), idc = s.id || 'id';
      const self = {
        async get() {
          const { data, error } = await sb.from(s.t).select('*').eq(idc, id).maybeSingle();
          if (error) throw error;
          return data ? wrap(s, data) : { id, exists: false, data: () => undefined };
        },
        async set(d) { const { error } = await sb.from(s.t).upsert(toRow(s, d, id)); if (error) throw error; },
        async update(d) {
          const cur = await self.get();
          if (!cur.exists) throw { code: 'not_found', message: 'missing' };
          const { error } = await sb.from(s.t).update(toRow(s, { ...cur.data(), ...d }, id)).eq(idc, id);
          if (error) throw error;
        },
        async delete() { const { error } = await sb.from(s.t).delete().eq(idc, id); if (error) throw error; },
        onSnapshot(n, err) {
          return watch('doc:' + p, s.t, `${idc}=eq.${id}`, async () => { try { n(await self.get()); } catch (e) { err && err(e); } });
        }
      };
      return self;
    },
    collection: c => {
      const s = SCHEMA[c];
      return {
        onSnapshot(n, err) {
          return watch('col:' + c, s.t, null, async () => {
            try { const r = await list(s); n({ docs: r.docs, size: r.docs.length }); } catch (e) { err && err(e); }
          });
        },
        where: (f, o, v) => ({ get: () => list(s, f, v) })
      };
    }
  };
}

function makeU(sb) {
  const nm = p => p.full_name || p.email;
  return {
    async me() {
      const { data: { user } } = await sb.auth.getUser();
      const { data: p, error } = await sb.from('profiles').select('full_name,email,role').eq('id', user.id).single();
      if (error) throw error;
      const adm = p.role === 'admin';
      return { id: user.id, name: nm(p), isOwner: adm, canEdit: adm };
    },
    async can() { return true; },
    async profiles(ids) {
      const { data } = await sb.from('profiles').select('id,full_name,email').in('id', ids);
      const o = {}; (data || []).forEach(p => o[p.id] = { name: nm(p) }); return o;
    },
    async search(q) {
      const s = q.replace(/[%,()]/g, '');
      const { data } = await sb.from('profiles').select('id,full_name,email').or(`full_name.ilike.%${s}%,email.ilike.%${s}%`).limit(8);
      return (data || []).map(p => ({ id: p.id, name: nm(p) }));
    }
  };
}
