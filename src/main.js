import { createClient } from '@supabase/supabase-js';

// Add your Supabase project URL and anon/publishable key to .env.local.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const liveMode = Boolean(supabase);
let currentSession = null;
let listingCache = [];
let accountTab = 'my-listings';
const STORAGE = { listings:'csh_listings_v1', requests:'csh_requests_v1', favorites:'csh_favorites_v1', bookings:'csh_bookings_v1' };

const seedListings = [
      {id:'demo-cam',title:'กล้อง Mirrorless พร้อมเลนส์คิท',category:'media',categoryLabel:'ถ่ายภาพและวิดีโอ',price:350,deposit:1500,location:'ใกล้คณะนิเทศฯ',owner:'นนท์',initial:'น',rating:'ผู้ให้เช่าตัวอย่าง',condition:'สภาพดี ใช้งานปกติ',description:'กล้องสำหรับถ่ายงานกิจกรรมหรือโปรเจกต์วิดีโอ มาพร้อมเลนส์คิท แบตเตอรี่ 1 ก้อน และสายคล้อง โปรดตรวจอุปกรณ์ร่วมกันตอนรับของ',image:'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=85',tag:'เหมาะกับโปรเจกต์',available:true},
      {id:'demo-mic',title:'ไมโครโฟนไร้สาย 2 ตัว',category:'media',categoryLabel:'ถ่ายภาพและวิดีโอ',price:150,deposit:500,location:'หอพักโซนเหนือ',owner:'แพร',initial:'พ',rating:'ผู้ให้เช่าตัวอย่าง',condition:'สภาพดี มีเคสเก็บ',description:'ไมโครโฟนไร้สายสำหรับสัมภาษณ์ ถ่ายคลิป หรืองานนำเสนอ กรุณาตรวจแบตเตอรี่และอุปกรณ์ในกล่องตอนรับสินค้า',image:'https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=900&q=85',tag:'ราคาประหยัด',available:true},
      {id:'demo-tripod',title:'ขาตั้งกล้องปรับระดับได้',category:'media',categoryLabel:'ถ่ายภาพและวิดีโอ',price:80,deposit:200,location:'อาคารกิจกรรมนักศึกษา',owner:'บอส',initial:'บ',rating:'ผู้ให้เช่าตัวอย่าง',condition:'มีรอยใช้งานเล็กน้อย',description:'ขาตั้งกล้องน้ำหนักเบา ปรับความสูงได้ มีหัวจับมาตรฐาน เหมาะกับงานถ่ายวิดีโอหรือถ่ายภาพนิ่ง',image:'https://images.unsplash.com/photo-1617005082133-548c4dd27f35?auto=format&fit=crop&w=900&q=85',tag:'ยอดนิยมในเดโม',available:true},
      {id:'demo-drill',title:'สว่านไฟฟ้าพร้อมดอกพื้นฐาน',category:'study',categoryLabel:'เรียนและโปรเจกต์',price:120,deposit:500,location:'ห้องชมรมเมกเกอร์',owner:'เจ',initial:'จ',rating:'ผู้ให้เช่าตัวอย่าง',condition:'ผ่านการตรวจสภาพในตัวอย่าง',description:'สำหรับงานประกอบชิ้นงานและโปรเจกต์เบื้องต้น ผู้ยืมควรมีความรู้การใช้งานที่ปลอดภัย และต้องคืนพร้อมอุปกรณ์ให้ครบ',image:'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=85',tag:'สำหรับงานประดิษฐ์',available:true},
      {id:'demo-projector',title:'โปรเจกเตอร์พกพา',category:'event',categoryLabel:'กิจกรรมและอีเวนต์',price:280,deposit:1000,location:'อาคารเรียนรวม',owner:'มิน',initial:'ม',rating:'ผู้ให้เช่าตัวอย่าง',condition:'สภาพดี พร้อมสายไฟ',description:'โปรเจกเตอร์สำหรับนำเสนอผลงานหรือกิจกรรมขนาดเล็ก ควรตรวจสอบพอร์ตและอุปกรณ์เชื่อมต่อที่ต้องใช้ก่อนทำรายการ',image:'https://images.unsplash.com/photo-1492619375914-88005aa9e8fb?auto=format&fit=crop&w=900&q=85',tag:'งานนำเสนอ',available:true},
      {id:'demo-suit',title:'ชุดสูทสีกรมท่า (ไซซ์ M)',category:'fashion',categoryLabel:'เสื้อผ้าและโอกาสพิเศษ',price:180,deposit:600,location:'หอพักโซนกลาง',owner:'ฟ้า',initial:'ฟ',rating:'ผู้ให้เช่าตัวอย่าง',condition:'ซักทำความสะอาดก่อนส่งมอบ',description:'ชุดสูทสำหรับสัมภาษณ์งาน นำเสนอ หรือกิจกรรมทางการ โปรดสอบถามขนาดและลองความพอดีก่อนยืนยันการจอง',image:'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=85',tag:'ใช้เฉพาะโอกาส',available:true}
    ];

const categoryLabels = {all:'ทุกหมวดหมู่',media:'ถ่ายภาพและวิดีโอ',study:'เรียนและโปรเจกต์',event:'กิจกรรมและอีเวนต์',fashion:'เสื้อผ้าและโอกาสพิเศษ',other:'อื่น ๆ'};
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
let activeCategory = 'all';
let searchTerm = '';
let budgetMax = 'all';
let sortMode = 'recommended';
let toastTimeout;

function readStore(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (error) { console.warn('อ่าน localStorage ไม่สำเร็จ', error); return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { showToast('บันทึกข้อมูลไม่สำเร็จ เบราว์เซอร์อาจจำกัดพื้นที่เก็บข้อมูล'); return false; }
}
function getListings() {
  if (liveMode) return listingCache;
  const saved = readStore(STORAGE.listings, null);
  if (!saved) { writeStore(STORAGE.listings, seedListings); return [...seedListings]; }
  return saved;
}
function getFavorites() { return readStore(STORAGE.favorites, []); }
function formatBaht(n) { return Number(n || 0).toLocaleString('th-TH'); }
function formatDateInput(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function formatDateThai(value) { if (!value) return '-'; const d = new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}); }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('show'), 3300);
}
function openModal(title, subtitle, content, wide=false) {
  $('#modalTitle').textContent = title; $('#modalSubtitle').textContent = subtitle || '';
  $('#modalContent').innerHTML = content; $('#modalBox').classList.toggle('wide', wide);
  $('#modalBackdrop').classList.add('open'); document.body.style.overflow = 'hidden';
  setTimeout(() => { const first = $('#modalContent input, #modalContent select, #modalContent textarea, #modalContent button'); if(first) first.focus(); }, 30);
}
function closeModal() { $('#modalBackdrop').classList.remove('open'); document.body.style.overflow = ''; }
function friendlyError(error) {
  const message = String(error?.message || error || 'เกิดข้อผิดพลาด');
  if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/email not confirmed/i.test(message)) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';
  if (/user already registered/i.test(message)) return 'อีเมลนี้สมัครสมาชิกแล้ว ลองเข้าสู่ระบบ';
  if (/password should be at least/i.test(message)) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
  if (/approved_dates_do_not_overlap|conflicting key|exclusion constraint/i.test(message)) return 'วันดังกล่าวมีการจองที่อนุมัติแล้ว กรุณาปฏิเสธคำขอนี้หรือเลือกวันอื่น';
  if (/row-level security|permission denied/i.test(message)) return 'ไม่มีสิทธิ์ทำรายการนี้ ตรวจสอบบัญชีและการตั้งค่า RLS ในฐานข้อมูล';
  return message;
}
function setConnectionNotice() {
  const box = $('#connectionNotice');
  box.hidden = false;
  const footer = $('#footerNote');
  if (liveMode) {
    box.style.background = '#e8f4e7'; box.style.borderColor = '#c7e0c3'; box.style.color = '#225b35';
    box.textContent = 'เชื่อมต่อโหมดฐานข้อมูลแล้ว: ประกาศและการจองจะถูกเก็บใน Supabase';
    if (footer) footer.innerHTML = 'Campus Sharing Hub · Supabase MVP<br>ประกาศและคำขอจองบันทึกลงฐานข้อมูลกลาง ไม่มีการชำระเงินจริง';
    $('#listingSectionDescription').textContent = 'รายการจากสมาชิกที่พร้อมให้เช่า ค้นหาและส่งคำขอจองได้';
  } else {
    box.style.background = '#fff8df'; box.style.borderColor = '#e9d8a6'; box.style.color = '#6b5310';
    box.innerHTML = 'เว็บไซต์ยังอยู่ใน <strong>โหมดตัวอย่าง</strong> เพราะยังไม่ได้ตั้งค่า Supabase — ข้อมูลที่สร้างจะอยู่ในเบราว์เซอร์นี้เท่านั้น เปิดไฟล์ <code>.env.example</code> และทำตามคู่มือ README เพื่อเปิดระบบจริง';
    if (footer) footer.innerHTML = 'Campus Sharing Hub · Prototype Demo<br>ข้อมูลรายการและธุรกรรมเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ยังไม่ใช่บริการเช่าจริง';
    $('#listingSectionDescription').textContent = 'รายการตัวอย่างสำหรับทดลองระบบ ราคาและข้อมูลเป็นข้อมูลสมมติ';
  }
}
function fromDbListing(row) {
  const owner = row.profiles?.full_name || row.owner_name || 'สมาชิก';
  return {
    id: row.id, owner_id: row.owner_id, title: row.title, category: row.category,
    categoryLabel: categoryLabels[row.category] || 'อื่น ๆ', price: Number(row.price_per_day), deposit: Number(row.deposit || 0),
    location: row.location, owner, initial: owner.slice(0,1), condition: row.condition,
    description: row.description, image: row.image_url || 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',
    tag: row.is_available ? 'สมาชิกลงประกาศ' : 'ไม่พร้อมให้เช่า', available: row.is_available,
    isReal: true, created_at: row.created_at
  };
}
async function refreshListings() {
  if (!liveMode) { renderListings(); return; }
  const { data, error } = await supabase.from('listings')
    .select('*, profiles!listings_owner_id_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('โหลดประกาศไม่สำเร็จ', error);
    showToast('โหลดรายการไม่สำเร็จ: ' + friendlyError(error));
    listingCache = [];
  } else {
    listingCache = (data || []).map(fromDbListing);
  }
  renderListings();
}
function updateAuthButtons() {
  const signedIn = Boolean(currentSession?.user);
  $('#openAuthTop').hidden = signedIn;
  $('#openAccountTop').hidden = !signedIn;
  $('#openAuthTop').textContent = 'เข้าสู่ระบบ';
  $('#openAccountTop').textContent = signedIn ? `บัญชี: ${currentSession.user.user_metadata?.full_name || currentSession.user.email?.split('@')[0] || 'ของฉัน'}` : 'บัญชีของฉัน';
}

function listingCard(item) {
  const favorites = getFavorites(); const saved = favorites.includes(item.id);
  return `<article class="listing-card">
    <div class="listing-image-wrap">
      <img class="listing-image" src="${escapeHTML(item.image || '')}" alt="${escapeHTML(item.title)}" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80'">
      <span class="tag">${escapeHTML(item.tag || item.categoryLabel || 'รายการใหม่')}</span>
      <button class="heart ${saved?'saved':''}" type="button" data-action="favorite" data-id="${escapeHTML(item.id)}" aria-pressed="${saved}" aria-label="${saved?'นำออกจากรายการที่บันทึก':'บันทึกประกาศนี้'}" title="${saved?'นำออกจากรายการโปรด':'บันทึกเป็นรายการโปรด'}">${saved?'♥':'♡'}</button>
    </div>
    <div class="listing-body"><div class="listing-meta"><span class="owner"><span class="avatar">${escapeHTML(item.initial || 'U')}</span>${escapeHTML(item.owner || 'สมาชิก')}</span><span class="badge-demo">${item.isReal?'สมาชิก':'ตัวอย่าง'}</span></div>
      <h3 class="listing-title">${escapeHTML(item.title)}</h3><div class="listing-location">⌖ ${escapeHTML(item.location || 'นัดรับในมหาวิทยาลัย')}</div>
      <div class="listing-bottom"><div><div class="price">฿${formatBaht(item.price)} <small>/ วัน</small></div><div class="deposit">${item.isReal?'เงินมัดจำ':'มัดจำตัวอย่าง'} ฿${formatBaht(item.deposit || 0)}</div></div><button class="tiny-btn" data-action="detail" data-id="${escapeHTML(item.id)}">ดูรายละเอียด ↗</button></div>
    </div>
  </article>`;
}
function renderListings() {
  let items = getListings().filter(x => x.available !== false);
  if (activeCategory === 'favorites') { const favorites = getFavorites(); items = items.filter(x => favorites.includes(x.id)); }
  else if (activeCategory !== 'all') items = items.filter(x => x.category === activeCategory);
  if (searchTerm) { const q = searchTerm.toLocaleLowerCase('th-TH'); items = items.filter(x => [x.title,x.description,x.categoryLabel,x.location,x.owner].some(v => String(v||'').toLocaleLowerCase('th-TH').includes(q))); }
  if (budgetMax !== 'all') items = items.filter(x => Number(x.price) <= Number(budgetMax));
  if (sortMode === 'priceAsc') items.sort((a,b)=>a.price-b.price);
  if (sortMode === 'priceDesc') items.sort((a,b)=>b.price-a.price);
  const grid = $('#listingGrid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><strong>${liveMode?'ยังไม่มีรายการที่ตรงกัน':'ยังไม่พบรายการที่ตรงกัน'}</strong><span>${liveMode?'ลองค้นหาคำอื่น หรือเข้าสู่ระบบแล้วลงประกาศชิ้นแรก':'เปลี่ยนคำค้นหาหรือหมวดหมู่ หรือแจ้งความต้องการเพื่อบันทึกสิ่งที่กำลังหา'}</span><br><button class="btn btn-primary" style="margin-top:15px" data-action="request">＋ แจ้งความต้องการ</button></div>`;
  } else grid.innerHTML = items.map(listingCard).join('');
  $$('#filterRow .chip').forEach(btn => { const active = btn.dataset.category === activeCategory; btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active)); });
  $$('#categoryGrid .category-card').forEach(btn => { const active = btn.dataset.category === activeCategory; btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active)); });
}
function listingDetail(id) {
  const item = getListings().find(x => x.id === id); if(!item) return showToast('ไม่พบรายการนี้');
  const ownItem = liveMode && currentSession?.user?.id === item.owner_id;
  const button = ownItem ? '<div class="form-footnote">นี่คือประกาศของคุณ จัดการสถานะได้จาก “บัญชีของฉัน”</div>' : `<button class="btn btn-primary" style="width:100%;margin-top:8px" data-action="book" data-id="${escapeHTML(item.id)}">ขอจองรายการนี้ ↗</button>`;
  const html = `<div class="detail-layout"><img class="detail-img" src="${escapeHTML(item.image || '')}" alt="${escapeHTML(item.title)}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80'"><div class="detail-copy"><span class="badge-demo">${escapeHTML(item.categoryLabel || 'รายการ')}</span><h3 style="margin-top:10px">${escapeHTML(item.title)}</h3><div class="listing-location">⌖ ${escapeHTML(item.location || 'นัดรับในมหาวิทยาลัย')}</div><div class="detail-price">฿${formatBaht(item.price)} <small>/ วัน</small></div><div class="detail-row"><span>เงินมัดจำ</span><strong>฿${formatBaht(item.deposit || 0)}</strong></div><div class="detail-row"><span>เจ้าของรายการ</span><strong>${escapeHTML(item.owner || 'สมาชิก')}</strong></div><div class="detail-row"><span>สภาพของ</span><strong>${escapeHTML(item.condition || 'โปรดตรวจสอบก่อนรับ')}</strong></div><p>${escapeHTML(item.description || 'ไม่มีรายละเอียดเพิ่มเติม')}</p>${button}<p class="form-footnote">คำขอจองจะส่งให้เจ้าของอนุมัติหรือปฏิเสธ ยังไม่มีการชำระเงินจริง</p></div></div>`;
  openModal('รายละเอียดรายการ','ตรวจสอบข้อมูลก่อนส่งคำขอจอง',html,true);
}
function openBooking(id) {
  const item = getListings().find(x=>x.id===id); if(!item) return showToast('ไม่พบรายการนี้');
  if (liveMode && !currentSession?.user) { closeModal(); openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนส่งคำขอจอง'); }
  if (liveMode && currentSession.user.id === item.owner_id) return showToast('คุณไม่สามารถจองประกาศของตัวเองได้');
  if (liveMode && item.available === false) return showToast('รายการนี้ไม่พร้อมให้เช่าในขณะนี้');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); const minDate = formatDateInput(tomorrow);
  const next = new Date(tomorrow); next.setDate(next.getDate()+1); const nextDate = formatDateInput(next);
  openModal('ส่งคำขอจอง',`รายการ: ${item.title}`,`<form id="bookingForm" data-id="${escapeHTML(item.id)}"><div class="form-grid">
    <div class="form-field"><label for="bookStart">วันรับของ</label><input type="date" id="bookStart" name="start" min="${minDate}" value="${minDate}" required></div>
    <div class="form-field"><label for="bookEnd">วันคืนของ</label><input type="date" id="bookEnd" name="end" min="${minDate}" value="${nextDate}" required></div>
    <div class="form-field full"><label for="bookPlace">จุดนัดรับที่สะดวก</label><input id="bookPlace" name="place" placeholder="เช่น หน้าอาคารเรียนรวม" required maxlength="100"></div>
    <div class="form-field full"><label for="bookNote">ข้อความถึงผู้ปล่อยเช่า <span class="hint">(ไม่บังคับ)</span></label><textarea id="bookNote" name="note" placeholder="เช่น ขอเช็กอุปกรณ์ก่อนรับของ" maxlength="300"></textarea></div>
  </div><div class="booking-total"><div><strong>ค่าเช่าต่อวัน</strong><div class="hint">฿${formatBaht(item.price)} / วัน · มัดจำ ฿${formatBaht(item.deposit||0)}</div></div><strong id="bookingEstimate">คำนวณหลังเลือกวัน</strong></div><p class="form-footnote">เมื่อส่งแล้ว เจ้าของรายการจะเห็นคำขอในบัญชีและเลือกอนุมัติหรือปฏิเสธได้</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="back-detail" data-id="${escapeHTML(item.id)}">กลับ</button><button type="submit" class="btn btn-primary">ส่งคำขอจอง</button></div></form>`);
  const form = $('#bookingForm');
  const updateEstimate = () => { const start=new Date(form.start.value+'T00:00:00'); const end=new Date(form.end.value+'T00:00:00'); const days=Math.max(0,Math.round((end-start)/86400000)+1); $('#bookingEstimate').textContent=days>0?'฿'+formatBaht(days*item.price):'เลือกวันให้ถูกต้อง'; };
  form.start.addEventListener('change',()=>{form.end.min=form.start.value;if(form.end.value<form.start.value)form.end.value=form.start.value;updateEstimate();}); form.end.addEventListener('change',updateEstimate); updateEstimate();
}
function openRequestForm() {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); const minDate=formatDateInput(tomorrow);
  openModal('แจ้งสิ่งที่ต้องการ','บันทึกความต้องการเพื่อใช้ตรวจสอบความต้องการของนักศึกษา',`<form id="requestForm"><div class="form-grid">
    <div class="form-field full"><label for="requestTitle">ต้องการเช่าอะไร? *</label><input id="requestTitle" name="title" required maxlength="100" placeholder="เช่น ไมโครโฟนไร้สายสำหรับถ่ายวิดีโอ"></div>
    <div class="form-field"><label for="requestCategory">หมวดหมู่ *</label><select id="requestCategory" name="category" required><option value="media">ถ่ายภาพและวิดีโอ</option><option value="study">เรียนและโปรเจกต์</option><option value="event">กิจกรรมและอีเวนต์</option><option value="fashion">เสื้อผ้าและโอกาสพิเศษ</option><option value="other">อื่น ๆ</option></select></div>
    <div class="form-field"><label for="requestBudget">งบประมาณต่อวัน (บาท) *</label><input id="requestBudget" name="budget" type="number" min="1" max="100000" required placeholder="เช่น 150"></div>
    <div class="form-field"><label for="requestStart">วันที่ต้องการใช้ *</label><input id="requestStart" name="date" type="date" min="${minDate}" required value="${minDate}"></div>
    <div class="form-field"><label for="requestDuration">ระยะเวลา *</label><select id="requestDuration" name="duration"><option value="1 วัน">1 วัน</option><option value="2 วัน">2 วัน</option><option value="3 วัน">3 วัน</option><option value="4–7 วัน">4–7 วัน</option><option value="มากกว่า 1 สัปดาห์">มากกว่า 1 สัปดาห์</option></select></div>
    <div class="form-field full"><label for="requestPickup">โซนรับของที่สะดวก *</label><input id="requestPickup" name="pickup" required maxlength="100" placeholder="เช่น ใกล้คณะวิศวกรรมศาสตร์"></div>
    <div class="form-field full"><label for="requestContact">ชื่อเล่น (ไม่บังคับ)</label><input id="requestContact" name="contact" maxlength="100" placeholder="ไม่ควรใส่ข้อมูลส่วนตัวที่สำคัญ"></div>
  </div><p class="form-footnote">ส่วนนี้ยังเป็นแบบบันทึกความต้องการในเบราว์เซอร์ ไม่ใช่หนึ่งในระบบหลักที่เชื่อมฐานข้อมูลของเวอร์ชันแรก</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close">ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึกความต้องการ</button></div></form>`);
}
function openListingForm() {
  if (liveMode && !currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนลงประกาศ'); }
  const ownerDefault = liveMode ? (currentSession.user.user_metadata?.full_name || currentSession.user.email?.split('@')[0] || '') : '';
  openModal('ลงประกาศปล่อยเช่า',liveMode?'ประกาศจะบันทึกลงฐานข้อมูลและแสดงให้ผู้ใช้คนอื่นค้นหาได้':'เพิ่มรายการตัวอย่างเพื่อทดลองหน้าประกาศ',`<form id="listingForm"><div class="form-grid">
    <div class="form-field full"><label for="newTitle">ชื่อสิ่งของ *</label><input id="newTitle" name="title" required maxlength="100" placeholder="เช่น ขาตั้งกล้องพร้อมหัวจับ"></div>
    <div class="form-field"><label for="newCategory">หมวดหมู่ *</label><select id="newCategory" name="category"><option value="media">ถ่ายภาพและวิดีโอ</option><option value="study">เรียนและโปรเจกต์</option><option value="event">กิจกรรมและอีเวนต์</option><option value="fashion">เสื้อผ้าและโอกาสพิเศษ</option><option value="other">อื่น ๆ</option></select></div>
    <div class="form-field"><label for="newPrice">ค่าเช่าต่อวัน (บาท) *</label><input id="newPrice" name="price" type="number" min="1" max="100000" required placeholder="เช่น 100"></div>
    <div class="form-field"><label for="newDeposit">เงินมัดจำ (บาท)</label><input id="newDeposit" name="deposit" type="number" min="0" max="1000000" value="0" required></div>
    <div class="form-field"><label for="newOwner">ชื่อที่แสดง</label><input id="newOwner" name="owner" maxlength="30" value="${escapeHTML(ownerDefault)}" ${liveMode?'readonly':''} ${liveMode?'':'required'} placeholder="เช่น มายด์"><span class="hint">${liveMode?'ใช้ชื่อจากบัญชีที่สมัครไว้':'ชื่อเจ้าของในข้อมูลตัวอย่าง'}</span></div>
    <div class="form-field full"><label for="newLocation">จุดนัดรับ *</label><input id="newLocation" name="location" required maxlength="100" placeholder="เช่น อาคารกิจกรรมนักศึกษา"></div>
    <div class="form-field full"><label for="newCondition">สภาพของ *</label><input id="newCondition" name="condition" required maxlength="120" placeholder="เช่น ใช้งานปกติ มีรอยเล็กน้อย"></div>
    <div class="form-field full"><label for="newDescription">รายละเอียด / อุปกรณ์ที่ให้มาด้วย *</label><textarea id="newDescription" name="description" required maxlength="500" placeholder="แจ้งตำหนิ เงื่อนไข และสิ่งที่ต้องตรวจสอบก่อนรับของ"></textarea></div>
    <div class="form-field full"><label for="newImage">ลิงก์รูปภาพ (ไม่บังคับ)</label><input id="newImage" name="image" type="url" placeholder="https://..."><span class="hint">ใช้ลิงก์รูปภาพที่เข้าถึงได้สาธารณะ</span></div>
  </div><p class="form-footnote">ผู้ลงประกาศรับผิดชอบข้อมูล ราคา เงื่อนไข และความปลอดภัยในการส่งมอบสินค้า</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close">ยกเลิก</button><button type="submit" class="btn btn-primary">${liveMode?'บันทึกประกาศ':'เพิ่มรายการตัวอย่าง'}</button></div></form>`);
}
function handleRequestSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if(!data.title.trim() || !data.date || Number(data.budget)<=0 || !data.pickup.trim()) return showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
  const requests=readStore(STORAGE.requests,[]); requests.unshift({...data,id:'req-'+Date.now(),createdAt:new Date().toISOString(),status:'บันทึกในเดโม'}); writeStore(STORAGE.requests,requests); closeModal(); showToast('บันทึกความต้องการในเบราว์เซอร์นี้แล้ว');
}
async function handleListingSubmit(form) {
  const data=Object.fromEntries(new FormData(form).entries());
  if(!data.title?.trim()||!data.location?.trim()||!data.condition?.trim()||!data.description?.trim()||Number(data.price)<=0) return showToast('กรุณาตรวจสอบชื่อ ราคา รายละเอียด และจุดนัดรับ');
  if (liveMode) {
    if (!currentSession?.user) return openAuthModal('login');
    const payload = { owner_id: currentSession.user.id, title:data.title.trim(), category:data.category, price_per_day:Number(data.price), deposit:Number(data.deposit||0), location:data.location.trim(), condition:data.condition.trim(), description:data.description.trim(), image_url:data.image?.trim() || null, is_available:true };
    const { error } = await supabase.from('listings').insert(payload);
    if (error) { showToast('บันทึกประกาศไม่สำเร็จ: '+friendlyError(error)); return; }
    await refreshListings();
    activeCategory='all'; searchTerm=''; $('#searchInput').value=''; $('#categorySelect').value='all'; budgetMax='all'; $('#budgetSelect').value='all';
    renderListings(); closeModal(); $('#explore').scrollIntoView({behavior:'smooth'}); showToast('ลงประกาศสำเร็จ ทุกคนสามารถค้นหารายการนี้ได้แล้ว'); return;
  }
  if(!data.owner?.trim()) return showToast('กรุณากรอกชื่อผู้ให้เช่า');
  const newItem={...data,id:'user-'+Date.now(),price:Number(data.price),deposit:Number(data.deposit||0),categoryLabel:categoryLabels[data.category]||'อื่น ๆ',initial:data.owner.trim().slice(0,1),tag:'ประกาศใหม่ · เดโม',image:data.image||'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',available:true};
  const all=getListings();all.unshift(newItem);writeStore(STORAGE.listings,all);activeCategory='all';searchTerm='';$('#searchInput').value='';$('#categorySelect').value='all';budgetMax='all';$('#budgetSelect').value='all';renderListings();closeModal();$('#explore').scrollIntoView({behavior:'smooth'});showToast('เพิ่มประกาศตัวอย่างในเบราว์เซอร์นี้แล้ว');
}
async function handleBookingSubmit(form) {
  const data=Object.fromEntries(new FormData(form).entries()); const item=getListings().find(x=>x.id===form.dataset.id); if(!item)return;
  if(!data.start||!data.end||data.end<data.start)return showToast('วันที่คืนต้องไม่อยู่ก่อนวันที่รับของ');
  const start=new Date(data.start+'T00:00:00'); const end=new Date(data.end+'T00:00:00'); const days=Math.round((end-start)/86400000)+1;
  if (liveMode) {
    if (!currentSession?.user) return openAuthModal('login');
    if (currentSession.user.id === item.owner_id) return showToast('คุณไม่สามารถจองประกาศของตัวเองได้');
    const payload = { listing_id:item.id, renter_id:currentSession.user.id, start_date:data.start, end_date:data.end, pickup_location:data.place.trim(), note:data.note?.trim() || null, status:'pending' };
    const { error } = await supabase.from('bookings').insert(payload);
    if (error) { showToast('ส่งคำขอจองไม่สำเร็จ: '+friendlyError(error)); return; }
    closeModal(); showToast(`ส่งคำขอจองแล้ว ${days} วัน รวมค่าเช่าโดยประมาณ ฿${formatBaht(days*item.price)} — รอเจ้าของตอบรับ`); return;
  }
  const bookings=readStore(STORAGE.bookings,[]);bookings.unshift({id:'book-'+Date.now(),listingId:item.id,title:item.title,start:data.start,end:data.end,days,place:data.place,note:data.note||'',estimate:days*item.price,status:'คำขอจำลอง',createdAt:new Date().toISOString()});writeStore(STORAGE.bookings,bookings);closeModal();showToast(`บันทึกคำขอจำลองแล้ว: ${days} วัน รวมค่าเช่าตัวอย่าง ฿${formatBaht(days*item.price)}`);
}
function toggleFavorite(id) {const fav=getFavorites();const next=fav.includes(id)?fav.filter(x=>x!==id):[...fav,id];writeStore(STORAGE.favorites,next);renderListings();showToast(next.includes(id)?'บันทึกไว้แล้ว':'นำออกจากรายการที่บันทึกแล้ว');}

function authMarkup(mode='login') {
  const signup = mode === 'signup';
  return `<div class="auth-mode-row"><button type="button" class="btn ${!signup?'btn-primary':'btn-secondary'}" data-action="auth-mode-login">เข้าสู่ระบบ</button><button type="button" class="btn ${signup?'btn-primary':'btn-secondary'}" data-action="auth-mode-signup">สมัครสมาชิก</button></div>
  <form id="authForm" data-mode="${signup?'signup':'login'}"><div class="form-grid">
    ${signup?'<div class="form-field full"><label for="authName">ชื่อที่ใช้แสดง *</label><input id="authName" name="full_name" required maxlength="60" autocomplete="name" placeholder="ชื่อเล่นหรือชื่อที่อยากให้แสดง"></div><div class="form-field full"><label for="authUniversity">สถานศึกษา *</label><input id="authUniversity" name="university" required maxlength="120" autocomplete="organization" placeholder="เช่น มหาวิทยาลัยของคุณ"></div>':''}
    <div class="form-field full"><label for="authEmail">อีเมล *</label><input id="authEmail" name="email" type="email" required autocomplete="email" placeholder="you@example.com"></div>
    <div class="form-field full"><label for="authPassword">รหัสผ่าน *</label><input id="authPassword" name="password" type="password" required minlength="6" autocomplete="${signup?'new-password':'current-password'}" placeholder="อย่างน้อย 6 ตัวอักษร"></div>
  </div><p id="authError" class="form-footnote" aria-live="polite"></p><p class="form-footnote">ใช้ข้อมูลที่คุณควบคุมได้ และห้ามใช้รหัสผ่านเดียวกับบัญชีสำคัญอื่น</p><div class="form-actions"><button type="submit" class="btn btn-primary">${signup?'สร้างบัญชี':'เข้าสู่ระบบ'}</button></div></form>`;
}
function openAuthModal(mode='login') {
  if (!liveMode) {
    openModal('ตั้งค่าระบบสมาชิก','ต้องต่อ Supabase ก่อนใช้บัญชีจริง',`<p>ตอนนี้เว็บกำลังอยู่ในโหมดตัวอย่าง เพราะยังไม่ได้กำหนดค่า Supabase ในไฟล์ <code>.env.local</code></p><p>เปิด README แล้วทำขั้นตอนตั้งค่าฐานข้อมูลและ URL/Key ก่อน จากนั้นรีสตาร์ต <code>npm run dev</code></p><div class="form-actions"><button class="btn btn-primary" data-action="close">เข้าใจแล้ว</button></div>`);
    return;
  }
  openModal(mode==='signup'?'สมัครสมาชิก':'เข้าสู่ระบบ', 'ใช้บัญชีนี้ลงประกาศและติดตามคำขอจอง', authMarkup(mode));
}
async function handleAuthSubmit(form) {
  if (!liveMode) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]'); if (button) { button.disabled=true; button.textContent='กำลังดำเนินการ…'; }
  let result;
  try {
    if (form.dataset.mode === 'signup') {
      result = await supabase.auth.signUp({ email:data.email.trim(), password:data.password, options:{ data:{ full_name:data.full_name.trim(), university:data.university.trim() } } });
      if (result.error) throw result.error;
      if (!result.data.session) {
        closeModal(); showToast('สมัครแล้ว กรุณาตรวจอีเมลและกดยืนยัน ก่อนเข้าสู่ระบบ'); return;
      }
      currentSession = result.data.session; updateAuthButtons(); closeModal(); showToast('สมัครสมาชิกสำเร็จ'); await refreshListings(); return;
    }
    result = await supabase.auth.signInWithPassword({email:data.email.trim(),password:data.password});
    if (result.error) throw result.error;
    currentSession = result.data.session; updateAuthButtons(); closeModal(); showToast('เข้าสู่ระบบสำเร็จ'); await refreshListings();
  } catch (error) {
    const target = $('#authError'); if (target) target.textContent = friendlyError(error);
  } finally {
    const liveButton = $('#authForm button[type="submit"]'); if (liveButton) { liveButton.disabled=false; liveButton.textContent=$('#authForm').dataset.mode==='signup'?'สร้างบัญชี':'เข้าสู่ระบบ'; }
  }
}

function statusText(status) { return ({pending:'รออนุมัติ',approved:'อนุมัติแล้ว',rejected:'ปฏิเสธ',cancelled:'ยกเลิก',completed:'เสร็จสิ้น'})[status] || status; }
function accountShell(tab) {
  const tabs = [['my-listings','ประกาศของฉัน'],['as-renter','รายการที่ฉันจอง'],['as-owner','คำขอที่ได้รับ']];
  return `<div class="account-tabs">${tabs.map(([key,label])=>`<button class="account-tab ${tab===key?'active':''}" data-action="account-tab" data-tab="${key}" aria-pressed="${tab===key}">${label}</button>`).join('')}<button class="account-tab" data-action="logout">ออกจากระบบ</button></div><div id="accountContent"><div class="account-empty">กำลังโหลดข้อมูล…</div></div>`;
}
function openAccountDashboard(tab='my-listings') {
  if (!liveMode) return openAuthModal('login');
  if (!currentSession?.user) return openAuthModal('login');
  accountTab = tab;
  const name = currentSession.user.user_metadata?.full_name || currentSession.user.email || 'สมาชิก';
  openModal('บัญชีของฉัน', `สวัสดี ${name} · จัดการประกาศและคำขอจอง`, accountShell(tab), true);
  renderAccountTab(tab);
}
async function renderAccountTab(tab) {
  if (!liveMode || !currentSession?.user || !$('#accountContent')) return;
  accountTab = tab;
  $$('.account-tab[data-action="account-tab"]').forEach(btn => { const active=btn.dataset.tab===tab; btn.classList.toggle('active',active); btn.setAttribute('aria-pressed',String(active)); });
  const out = $('#accountContent'); out.innerHTML='<div class="account-empty">กำลังโหลดข้อมูล…</div>';
  const uid = currentSession.user.id;
  try {
    if (tab === 'my-listings') {
      const {data,error}=await supabase.from('listings').select('*').eq('owner_id',uid).order('created_at',{ascending:false});
      if(error) throw error;
      if(!data?.length){out.innerHTML='<div class="account-empty">คุณยังไม่มีประกาศ กดปุ่ม “ลงประกาศปล่อยเช่า” เพื่อเพิ่มรายการแรก</div>';return;}
      out.innerHTML=`<div class="account-list">${data.map(row=>`<div class="account-row"><div><h3>${escapeHTML(row.title)}</h3><p>฿${formatBaht(row.price_per_day)} / วัน · ${escapeHTML(row.location)}</p><p><span class="status-pill ${row.is_available?'approved':'cancelled'}">${row.is_available?'เปิดให้เช่า':'ซ่อนประกาศ'}</span> · เพิ่มเมื่อ ${formatDateThai(String(row.created_at||'').slice(0,10))}</p></div><div class="account-actions"><button class="btn btn-secondary" data-action="toggle-listing" data-id="${row.id}" data-available="${row.is_available}">${row.is_available?'ซ่อนประกาศ':'เปิดให้เช่า'}</button><button class="btn btn-danger" data-action="delete-listing" data-id="${row.id}">ลบ</button></div></div>`).join('')}</div>`; return;
    }
    if (tab === 'as-renter') {
      const {data,error}=await supabase.from('bookings').select('*').eq('renter_id',uid).order('created_at',{ascending:false});
      if(error) throw error;
      const rows=data||[]; const itemIds=[...new Set(rows.map(x=>x.listing_id))];
      const listingsMap={};
      if(itemIds.length){const r=await supabase.from('listings').select('id,title,price_per_day,location,owner_id').in('id',itemIds); if(!r.error) for(const it of r.data||[])listingsMap[it.id]=it;}
      if(!rows.length){out.innerHTML='<div class="account-empty">คุณยังไม่ได้ส่งคำขอจองสินค้า</div>';return;}
      out.innerHTML=`<div class="account-list">${rows.map(row=>{const item=listingsMap[row.listing_id]||{};return `<div class="account-row"><div><h3>${escapeHTML(item.title||'ประกาศสินค้า')}</h3><p>${formatDateThai(row.start_date)} – ${formatDateThai(row.end_date)} · ${escapeHTML(row.pickup_location||'-')}</p><p>ค่าเช่ารวม ฿${formatBaht(row.total_price)} · <span class="status-pill ${escapeHTML(row.status)}">${statusText(row.status)}</span></p>${row.note?`<p>ข้อความ: ${escapeHTML(row.note)}</p>`:''}</div><div class="account-actions">${row.status==='pending'?`<button class="btn btn-danger" data-action="cancel-booking" data-id="${row.id}">ยกเลิกคำขอ</button>`:''}</div></div>`}).join('')}</div>`; return;
    }
    const {data:myListings,error:listError}=await supabase.from('listings').select('id').eq('owner_id',uid);
    if(listError) throw listError;
    const ids=(myListings||[]).map(x=>x.id);
    if(!ids.length){out.innerHTML='<div class="account-empty">เมื่อคุณลงประกาศและมีคนส่งคำขอจอง คำขอจะปรากฏที่นี่</div>';return;}
    const {data,error}=await supabase.from('bookings').select('*').in('listing_id',ids).order('created_at',{ascending:false});
    if(error) throw error;
    const rows=data||[]; const listingById={};
    const {data:ownedRows}=await supabase.from('listings').select('id,title,price_per_day,location').in('id',ids);
    for(const it of ownedRows||[])listingById[it.id]=it;
    const renterIds=[...new Set(rows.map(x=>x.renter_id))]; const names={};
    if(renterIds.length){const prof=await supabase.from('profiles').select('id,full_name').in('id',renterIds);if(!prof.error)for(const pr of prof.data||[])names[pr.id]=pr.full_name;}
    if(!rows.length){out.innerHTML='<div class="account-empty">ยังไม่มีใครส่งคำขอจองประกาศของคุณ</div>';return;}
    out.innerHTML=`<div class="account-list">${rows.map(row=>{const item=listingById[row.listing_id]||{};return `<div class="account-row"><div><h3>${escapeHTML(item.title||'ประกาศสินค้า')}</h3><p>ผู้จอง: ${escapeHTML(names[row.renter_id]||'สมาชิก')} · ${formatDateThai(row.start_date)} – ${formatDateThai(row.end_date)}</p><p>จุดนัดรับ: ${escapeHTML(row.pickup_location||'-')} · ค่าเช่ารวม ฿${formatBaht(row.total_price)}</p>${row.note?`<p>ข้อความ: ${escapeHTML(row.note)}</p>`:''}<p><span class="status-pill ${escapeHTML(row.status)}">${statusText(row.status)}</span></p></div><div class="account-actions">${row.status==='pending'?`<button class="btn btn-primary" data-action="booking-approve" data-id="${row.id}">อนุมัติ</button><button class="btn btn-danger" data-action="booking-reject" data-id="${row.id}">ปฏิเสธ</button>`:''}</div></div>`}).join('')}</div>`;
  } catch(error) {
    out.innerHTML=`<div class="account-empty">โหลดข้อมูลไม่ได้: ${escapeHTML(friendlyError(error))}</div>`;
  }
}
async function processBookingDecision(id,status) {
  const {error}=await supabase.rpc('respond_to_booking',{p_booking_id:id,p_status:status});
  if(error){showToast('เปลี่ยนสถานะไม่ได้: '+friendlyError(error));return;}
  showToast(status==='approved'?'อนุมัติการจองแล้ว':'ปฏิเสธคำขอแล้ว');
  await renderAccountTab(accountTab);
}
async function logout() {
  const {error}=await supabase.auth.signOut();
  if(error) return showToast('ออกจากระบบไม่สำเร็จ: '+friendlyError(error));
  currentSession=null; updateAuthButtons(); closeModal(); showToast('ออกจากระบบแล้ว');
}
async function manageListing(id,action,currentAvailable) {
  if(!currentSession?.user) return openAuthModal('login');
  let result;
  if(action==='delete') {
    if(!confirm('ต้องการลบประกาศนี้ใช่ไหม? การลบจะไม่สามารถย้อนกลับได้')) return;
    const check=await supabase.from('bookings').select('id',{count:'exact',head:true}).eq('listing_id',id);
    if(check.error) return showToast('ตรวจสอบประวัติการจองไม่สำเร็จ: '+friendlyError(check.error));
    if((check.count||0)>0) return showToast('รายการนี้มีประวัติการจอง จึงลบไม่ได้เพื่อเก็บประวัติไว้ คุณสามารถซ่อนประกาศแทนได้');
    result=await supabase.from('listings').delete().eq('id',id).eq('owner_id',currentSession.user.id);
  } else {
    result=await supabase.from('listings').update({is_available:!currentAvailable}).eq('id',id).eq('owner_id',currentSession.user.id);
  }
  if(result.error) return showToast('จัดการประกาศไม่สำเร็จ: '+friendlyError(result.error));
  await refreshListings(); await renderAccountTab('my-listings'); showToast(action==='delete'?'ลบประกาศแล้ว':currentAvailable?'ซ่อนประกาศแล้ว':'เปิดประกาศให้เช่าแล้ว');
}
async function cancelBooking(id) {
  const {error}=await supabase.from('bookings').update({status:'cancelled'}).eq('id',id).eq('renter_id',currentSession.user.id).eq('status','pending');
  if(error) return showToast('ยกเลิกคำขอไม่สำเร็จ: '+friendlyError(error));
  showToast('ยกเลิกคำขอจองแล้ว'); await renderAccountTab('as-renter');
}

// Event delegation for buttons created inside dialogs/cards.
document.addEventListener('click', async event => {
  const actionEl=event.target.closest('[data-action]');
  if(!actionEl) return;
  const action=actionEl.dataset.action, id=actionEl.dataset.id;
  if(action==='detail') listingDetail(id);
  else if(action==='favorite'){event.stopPropagation();toggleFavorite(id);}
  else if(action==='book') openBooking(id);
  else if(action==='request') openRequestForm();
  else if(action==='close') closeModal();
  else if(action==='back-detail') listingDetail(id);
  else if(action==='open-listing') openListingForm();
  else if(action==='auth-mode-login') openAuthModal('login');
  else if(action==='auth-mode-signup') openAuthModal('signup');
  else if(action==='logout') await logout();
  else if(action==='account-tab') await renderAccountTab(actionEl.dataset.tab);
  else if(action==='booking-approve') await processBookingDecision(id,'approved');
  else if(action==='booking-reject') await processBookingDecision(id,'rejected');
  else if(action==='cancel-booking') await cancelBooking(id);
  else if(action==='toggle-listing') await manageListing(id,'toggle',actionEl.dataset.available==='true');
  else if(action==='delete-listing') await manageListing(id,'delete',false);
});
document.addEventListener('submit',event=>{
  if(event.target.id==='searchForm'){event.preventDefault();searchTerm=$('#searchInput').value.trim();activeCategory=$('#categorySelect').value;budgetMax=$('#budgetSelect').value;renderListings();$('#explore').scrollIntoView({behavior:'smooth'});}
  if(event.target.id==='requestForm'){event.preventDefault();handleRequestSubmit(event.target);}
  if(event.target.id==='listingForm'){event.preventDefault();handleListingSubmit(event.target);}
  if(event.target.id==='bookingForm'){event.preventDefault();handleBookingSubmit(event.target);}
  if(event.target.id==='authForm'){event.preventDefault();handleAuthSubmit(event.target);}
});
$('#filterRow').addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;activeCategory=btn.dataset.category;renderListings();});
$('#categoryGrid').addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;activeCategory=btn.dataset.category;$('#categorySelect').value=activeCategory;renderListings();$('#explore').scrollIntoView({behavior:'smooth'});});
$('#sortSelect').addEventListener('change',e=>{sortMode=e.target.value;renderListings();});
$('#closeModal').addEventListener('click',closeModal);
$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
['#openRequestTop','#openRequestHero','#openRequestMain','#openRequestMobile'].forEach(sel=>$(sel)?.addEventListener('click',openRequestForm));
['#openListingTop','#openListingMobile'].forEach(sel=>$(sel)?.addEventListener('click',openListingForm));
$('#openAuthTop')?.addEventListener('click',()=>openAuthModal('login'));
$('#openAccountTop')?.addEventListener('click',()=>openAccountDashboard());
$('#mobileMenu').addEventListener('click',()=>{openModal('เมนู','เลือกส่วนที่ต้องการไป',`<div style="display:grid;gap:10px"><button class="btn btn-secondary" data-action="auth-mode-login">เข้าสู่ระบบ / สมัครสมาชิก</button><button class="btn btn-secondary" data-action="open-listing">ลงประกาศ</button><a class="btn btn-secondary" href="#explore" data-action="close">ค้นหาของ</a><a class="btn btn-secondary" href="#demand" data-action="close">แจ้งสิ่งที่ต้องการ</a><a class="btn btn-secondary" href="#how" data-action="close">วิธีใช้งาน</a><button class="btn btn-primary" data-action="close">ปิดเมนู</button></div>`);});

async function initialize() {
  setConnectionNotice();
  if (!liveMode) {
    getListings(); renderListings(); updateAuthButtons(); return;
  }
  const {data,error}=await supabase.auth.getSession();
  if(error) console.warn('อ่าน session ไม่สำเร็จ',error);
  currentSession=data?.session||null;
  updateAuthButtons();
  await refreshListings();
  supabase.auth.onAuthStateChange((_event,session)=>{
    currentSession=session; updateAuthButtons();
    // Defer network calls out of the auth callback to avoid auth-lock deadlocks.
    setTimeout(()=>refreshListings(),0);
  });
}
initialize();
