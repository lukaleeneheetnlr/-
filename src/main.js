import { createClient } from '@supabase/supabase-js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Add your Supabase project URL and anon/publishable key to .env.local.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
const liveMode = Boolean(supabase);
let currentSession = null;
let currentProfile = null;
let currentIsAdmin = false;
let listingCache = [];
let accountTab = 'my-listings';
let authGeneration = 0;
let authSubscription = null;
let realtimeChannels = [];
let activeConversation = null;
let conversationChannel = null;
let conversationRecoveryTimer = null;
let notificationRecoveryTimer = null;
let notificationCache = [];
let notificationOffset = 0;
const NOTIFICATION_PAGE_SIZE = 50;
let listingMap = null;
let listingMarkers = [];
let mapMode = false;
let locationPickerMap = null;
let locationPickerMarker = null;
const THAILAND_BOUNDS = [[5.6, 97.3], [20.5, 105.7]];
const LISTING_IMAGE_BUCKET = 'listing-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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
async function loadCurrentProfile(userId = currentSession?.user?.id) {
  if (!liveMode || !userId) {
    currentProfile = null;
    currentIsAdmin = false;
    updateAuthButtons();
    return;
  }
  const { data, error } = await supabase.from('profiles')
    .select('id,full_name,university,is_admin')
    .eq('id', userId).maybeSingle();
  if (currentSession?.user?.id !== userId) return;
  if (error) {
    console.warn('โหลดโปรไฟล์/สิทธิ์ไม่สำเร็จ ตรวจ migration ของ Supabase', error);
    currentProfile = null;
    currentIsAdmin = false;
    showToast('ตรวจสอบสิทธิ์บัญชีไม่สำเร็จ: ' + friendlyError(error));
  } else {
    currentProfile = data || null;
    currentIsAdmin = Boolean(data?.is_admin);
  }
  updateAuthButtons();
}
async function uploadListingImage(file) {
  if (!file || !file.size) return { url: null, path: null };
  if (!liveMode || !supabase) throw new Error('ต้องตั้งค่า Supabase ก่อนอัปโหลดรูป');
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) throw new Error('รองรับเฉพาะรูป JPG, PNG, WebP หรือ GIF');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('รูปต้องมีขนาดไม่เกิน 5 MB');
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
  const path = `${currentSession.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(LISTING_IMAGE_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type
  });
  if (error) throw error;
  const { data } = supabase.storage.from(LISTING_IMAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}
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
function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
  if (locationPickerMap) {
    locationPickerMap.remove();
    locationPickerMap = null;
    locationPickerMarker = null;
  }
  if (activeConversation) {
    activeConversation = null;
    if (conversationChannel) void supabase.removeChannel(conversationChannel);
    conversationChannel = null;
    if (conversationRecoveryTimer) clearInterval(conversationRecoveryTimer);
  }
}
function friendlyError(error) {
  const message = String(error?.message || error || 'เกิดข้อผิดพลาด');
  if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/email not confirmed/i.test(message)) return 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';
  if (/user already registered/i.test(message)) return 'อีเมลนี้สมัครสมาชิกแล้ว ลองเข้าสู่ระบบ';
  if (/password should be at least/i.test(message)) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
  if (/approved_dates_do_not_overlap|conflicting key|exclusion constraint/i.test(message)) return 'วันดังกล่าวมีการจองที่อนุมัติแล้ว กรุณาปฏิเสธคำขอนี้หรือเลือกวันอื่น';
  if (/conversations_listing_id_fkey/i.test(message)) return 'ลบประกาศนี้ไม่ได้เพราะมีประวัติแชตอยู่ คุณสามารถซ่อนประกาศแทนได้';
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
    description: row.description, image: row.image_url || 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80', image_path: row.image_path || null,
    tag: row.is_available ? 'สมาชิกลงประกาศ' : 'ไม่พร้อมให้เช่า', available: row.is_available,
    latitude: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
    longitude: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
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
  const loginButton = $('#openAuthTop');
  const accountButton = $('#openAccountTop');
  if (loginButton) loginButton.hidden = signedIn;
  if (accountButton) {
    accountButton.hidden = !signedIn;
    accountButton.textContent = signedIn ? (currentIsAdmin ? 'แอดมิน' : `บัญชี: ${currentProfile?.full_name || currentSession.user.user_metadata?.full_name || currentSession.user.email?.split('@')[0] || 'ของฉัน'}`) : 'บัญชีของฉัน';
  }
  const inboxButton = $('#openInboxTop');
  const notificationButton = $('#openNotificationsTop');
  if (inboxButton) inboxButton.hidden = !signedIn;
  if (notificationButton) notificationButton.hidden = !signedIn;
}

function renderListingMap(items = getListings().filter(item => item.available !== false)) {
  const mapElement = $('#listingMap');
  if (!mapElement || !mapMode) return;
  if (!listingMap) {
    listingMap = L.map(mapElement, { scrollWheelZoom: false }).fitBounds(THAILAND_BOUNDS, { padding: [18, 18] });
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'map-message map-loading';
    loadingMessage.textContent = 'กำลังโหลดแผนที่จาก OpenStreetMap…';
    mapElement.append(loadingMessage);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
    }).addTo(listingMap);
    tiles.on('load', () => {
      mapElement.querySelector('.map-loading')?.remove();
    });
    let tileErrorShown = false;
    tiles.on('tileerror', () => {
      mapElement.querySelector('.map-loading')?.remove();
      if (tileErrorShown) return;
      tileErrorShown = true;
      showToast('โหลดแผนที่ไม่สำเร็จ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
    });
  }
  listingMarkers.forEach(marker => marker.remove());
  listingMarkers = [];
  const located = items.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
  const existingMessage = mapElement.querySelector('.map-empty');
  if (existingMessage) existingMessage.remove();
  if (!located.length) {
    const message = document.createElement('div');
    message.className = 'map-message map-empty';
    message.textContent = liveMode
      ? 'ยังไม่มีประกาศที่บันทึกพิกัดโดยประมาณไว้ จุดรับเดิมไม่ได้ถูกคาดเดาหรือเติมพิกัดให้อัตโนมัติ'
      : 'แผนที่จะแสดงพิกัดจริงที่เจ้าของประกาศบันทึกไว้เมื่อเชื่อมต่อฐานข้อมูล';
    mapElement.append(message);
    listingMap.fitBounds(THAILAND_BOUNDS, { padding: [18, 18] });
    return;
  }
  const bounds = [];
  for (const item of located) {
    const point = [item.latitude, item.longitude];
    bounds.push(point);
    const marker = L.marker(point, {
      icon: L.divIcon({
        className: 'price-marker-wrap',
        html: `<span class="price-marker">฿${formatBaht(item.price)}</span>`,
        iconSize: [76, 30],
        iconAnchor: [38, 30]
      })
    }).addTo(listingMap);
    marker.bindPopup(`<article class="map-popup"><img src="${escapeHTML(item.image || '')}" alt=""><div><strong>${escapeHTML(item.title)}</strong><span>฿${formatBaht(item.price)} / วัน</span><small>พร้อมให้เช่า · ${escapeHTML(item.location || 'ยังไม่ได้ระบุตำแหน่ง')}</small><button type="button" data-action="detail" data-id="${escapeHTML(item.id)}">ดูรายละเอียด</button></div></article>`);
    listingMarkers.push(marker);
  }
  if (bounds.length === 1) listingMap.setView(bounds[0], 15);
  else listingMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
}

function setListingsView(useMap) {
  mapMode = useMap;
  $('#listingGrid').hidden = useMap;
  $('#listingMap').hidden = !useMap;
  $('#listViewButton').classList.toggle('active', !useMap);
  $('#mapViewButton').classList.toggle('active', useMap);
  $('#listViewButton').setAttribute('aria-pressed', String(!useMap));
  $('#mapViewButton').setAttribute('aria-pressed', String(useMap));
  if (useMap) {
    renderListings();
    requestAnimationFrame(() => listingMap?.invalidateSize());
  }
}

function initializeLocationPicker(item) {
  const element = $('#locationPicker');
  if (!element || !liveMode) return;
  const latInput = $('#newLatitude');
  const lngInput = $('#newLongitude');
  const coordsPresent = Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude);
  const initialPoint = coordsPresent ? [item.latitude, item.longitude] : null;
  locationPickerMap = L.map(element);
  if (initialPoint) locationPickerMap.setView(initialPoint, 15);
  else locationPickerMap.fitBounds(THAILAND_BOUNDS, { padding: [18, 18] });
  const loadingMessage = document.createElement('div');
  loadingMessage.className = 'map-message map-loading';
  loadingMessage.textContent = 'กำลังโหลดแผนที่จาก OpenStreetMap…';
  element.append(loadingMessage);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  }).addTo(locationPickerMap);
  tiles.on('load', () => loadingMessage.remove());
  let pickerErrorShown = false;
  tiles.on('tileerror', () => {
    loadingMessage.remove();
    if (pickerErrorShown) return;
    pickerErrorShown = true;
    showToast('โหลดแผนที่เลือกจุดรับไม่สำเร็จ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  });
  const updateCoordinates = point => {
    latInput.value = point.lat.toFixed(6);
    lngInput.value = point.lng.toFixed(6);
  };
  const placeMarker = point => {
    if (!locationPickerMarker) {
      locationPickerMarker = L.marker(point, {
        draggable:true,
        icon:L.divIcon({
          className:'location-marker-wrap',
          html:'<span class="location-marker"></span>',
          iconSize:[24,24],
          iconAnchor:[12,12]
        })
      }).addTo(locationPickerMap);
      locationPickerMarker.on('dragend', event => updateCoordinates(event.target.getLatLng()));
    } else locationPickerMarker.setLatLng(point);
    updateCoordinates(L.latLng(point));
  };
  if (initialPoint) placeMarker({ lat:initialPoint[0], lng:initialPoint[1] });
  locationPickerMap.on('click', event => placeMarker(event.latlng));
  const syncMarker = () => {
    if (!latInput.value.trim() && !lngInput.value.trim()) {
      locationPickerMarker?.remove();
      locationPickerMarker = null;
      locationPickerMap.fitBounds(THAILAND_BOUNDS, { padding: [18, 18] });
      return;
    }
    if (!latInput.value.trim() || !lngInput.value.trim()) return;
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const point = { lat, lng };
    placeMarker(point);
    locationPickerMap.setView([lat, lng], Math.max(locationPickerMap.getZoom(), 14));
  };
  latInput.addEventListener('change', syncMarker);
  lngInput.addEventListener('change', syncMarker);
  requestAnimationFrame(() => locationPickerMap?.invalidateSize());
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
      <h3 class="listing-title">${escapeHTML(item.title)}</h3><div class="listing-location">⌖ ${escapeHTML(item.location || 'ยังไม่ได้ระบุตำแหน่ง')}</div>
      <div class="listing-bottom"><div class="listing-price-group"><span class="availability-label"><span aria-hidden="true"></span>พร้อมให้เช่า</span><div class="price">฿${formatBaht(item.price)} <small>/ วัน</small></div><div class="deposit">${item.isReal?'เงินมัดจำ':'มัดจำตัวอย่าง'} ฿${formatBaht(item.deposit || 0)}</div></div><div class="listing-actions"><button class="tiny-btn detail-btn" type="button" data-action="detail" data-id="${escapeHTML(item.id)}">รายละเอียด</button><button class="btn btn-primary card-book-btn" type="button" data-action="book" data-id="${escapeHTML(item.id)}" aria-label="ขอจอง ${escapeHTML(item.title)}">ขอจอง</button></div></div>
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
  if (mapMode) renderListingMap(items);
  $$('#filterRow .chip').forEach(btn => { const active = btn.dataset.category === activeCategory; btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active)); });
  $$('#categoryGrid .category-card').forEach(btn => { const active = btn.dataset.category === activeCategory; btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active)); });
}
function listingDetail(id) {
  const item = getListings().find(x => x.id === id); if(!item) return showToast('ไม่พบรายการนี้');
  const ownItem = liveMode && currentSession?.user?.id === item.owner_id;
  const button = ownItem
    ? '<div class="form-footnote">นี่คือประกาศของคุณ จัดการสถานะได้จาก “บัญชีของฉัน”</div>'
    : `${liveMode?`<button class="btn btn-secondary" style="width:100%;margin-top:8px" data-action="listing-chat" data-id="${escapeHTML(item.id)}">แชตกับเจ้าของ</button>`:''}<button class="btn btn-primary" style="width:100%;margin-top:8px" data-action="book" data-id="${escapeHTML(item.id)}">ขอจองรายการนี้</button>`;
  const html = `<div class="detail-layout"><img class="detail-img" src="${escapeHTML(item.image || '')}" alt="${escapeHTML(item.title)}" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80'"><div class="detail-copy"><span class="badge-demo">${escapeHTML(item.categoryLabel || 'รายการ')}</span><h3 style="margin-top:10px">${escapeHTML(item.title)}</h3><div class="listing-location">⌖ ${escapeHTML(item.location || 'ยังไม่ได้ระบุตำแหน่ง')}</div><div class="detail-price">฿${formatBaht(item.price)} <small>/ วัน</small></div><div class="detail-row"><span>เงินมัดจำ</span><strong>฿${formatBaht(item.deposit || 0)}</strong></div><div class="detail-row"><span>เจ้าของรายการ</span><strong>${escapeHTML(item.owner || 'สมาชิก')}</strong></div><div class="detail-row"><span>สภาพของ</span><strong>${escapeHTML(item.condition || 'ยังไม่ได้ระบุสภาพ')}</strong></div><p>${escapeHTML(item.description || 'ยังไม่ได้ระบุรายละเอียด')}</p>${button}<p class="form-footnote">คำขอจองจะส่งให้เจ้าของอนุมัติหรือปฏิเสธ ยังไม่มีการชำระเงินจริง</p></div></div>`;
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
  if (liveMode && !currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนแจ้งสิ่งที่ต้องการ'); }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); const minDate=formatDateInput(tomorrow);
  openModal('แจ้งสิ่งที่ต้องการ','เผยแพร่ความต้องการให้นักศึกษาคนอื่นเสนอสินค้าได้',`<form id="requestForm"><div class="form-grid">
    <div class="form-field full"><label for="requestTitle">ต้องการเช่าอะไร? *</label><input id="requestTitle" name="title" required maxlength="100" placeholder="เช่น ไมโครโฟนไร้สายสำหรับถ่ายวิดีโอ"></div>
    <div class="form-field"><label for="requestCategory">หมวดหมู่ *</label><select id="requestCategory" name="category" required><option value="media">ถ่ายภาพและวิดีโอ</option><option value="study">เรียนและโปรเจกต์</option><option value="event">กิจกรรมและอีเวนต์</option><option value="fashion">เสื้อผ้าและโอกาสพิเศษ</option><option value="other">อื่น ๆ</option></select></div>
    <div class="form-field"><label for="requestBudget">งบประมาณต่อวัน (บาท) *</label><input id="requestBudget" name="budget" type="number" min="1" max="100000" required placeholder="เช่น 150"></div>
    <div class="form-field"><label for="requestStart">วันที่ต้องการใช้ *</label><input id="requestStart" name="date" type="date" min="${minDate}" required value="${minDate}"></div>
    <div class="form-field"><label for="requestDuration">ระยะเวลา *</label><input id="requestDuration" name="duration" type="text" required maxlength="80" placeholder="เช่น 1–2 วัน, 1 สัปดาห์ หรือเฉพาะวันเสาร์–อาทิตย์"></div>
    <div class="form-field full"><label for="requestPickup">โซนรับของที่สะดวก *</label><input id="requestPickup" name="pickup" required maxlength="100" placeholder="เช่น ใกล้คณะวิศวกรรมศาสตร์"></div>
    <div class="form-field full"><label for="requestDetails">รายละเอียดเพิ่มเติม</label><textarea id="requestDetails" name="note" maxlength="500" placeholder="เช่น ต้องการอุปกรณ์ครบชุด หรือมีเงื่อนไขเพิ่มเติม"></textarea></div>
  </div><p class="form-footnote">อย่าใส่ข้อมูลส่วนตัวที่สำคัญในประกาศที่ผู้อื่นมองเห็นได้</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close">ยกเลิก</button><button type="submit" class="btn btn-primary">เผยแพร่ความต้องการ</button></div></form>`);
}
async function openListingForm(listingId = null) {
  if (liveMode && !currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนลงประกาศ'); }
  const mode = listingId ? 'edit' : 'create';
  let editItem = null;
  if (mode === 'edit') {
    if (typeof listingId !== 'string' || !listingId.trim()) return showToast('รหัสประกาศสำหรับแก้ไขไม่ถูกต้อง');
    if (liveMode) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId)) {
        return showToast('รหัสประกาศสำหรับแก้ไขไม่ถูกต้อง');
      }
      try {
        const { data, error } = await supabase.from('listings')
          .select('*, profiles!listings_owner_id_fkey(full_name)')
          .eq('id', listingId).maybeSingle();
        if (error) return showToast('โหลดประกาศเพื่อแก้ไขไม่สำเร็จ: ' + friendlyError(error));
        if (!data) return showToast('ไม่พบประกาศที่ต้องการแก้ไข');
        editItem = fromDbListing(data);
      } catch (error) {
        return showToast('โหลดประกาศเพื่อแก้ไขไม่สำเร็จ: ' + friendlyError(error));
      }
    } else {
      editItem = getListings().find(item => item.id === listingId) || null;
      if (!editItem) return showToast('ไม่พบประกาศที่ต้องการแก้ไข');
    }
  }
  if (editItem && currentSession?.user?.id !== editItem.owner_id && !currentIsAdmin) return showToast('คุณไม่มีสิทธิ์แก้ไขประกาศนี้');
  const ownerDefault = liveMode ? (currentSession.user.user_metadata?.full_name || currentSession.user.email?.split('@')[0] || '') : '';
  const categories = ['media','study','event','fashion','other'].map(category => `<option value="${category}" ${editItem?.category===category?'selected':''}>${escapeHTML(categoryLabels[category])}</option>`).join('');
  openModal(mode === 'edit' ? 'แก้ไขประกาศ' : 'ลงประกาศปล่อยเช่า',liveMode?'ประกาศจะบันทึกลงฐานข้อมูลและแสดงให้ผู้ใช้คนอื่นค้นหาได้':'เพิ่มรายการตัวอย่างเพื่อทดลองหน้าประกาศ',`<form id="listingForm" data-mode="${mode}" data-id="${escapeHTML(editItem?.id || '')}" data-image-path="${escapeHTML(editItem?.image_path || '')}"><div class="form-grid">
    <div class="form-field full"><label for="newTitle">ชื่อสิ่งของ *</label><input id="newTitle" name="title" required minlength="2" maxlength="100" value="${escapeHTML(editItem?.title || '')}" placeholder="เช่น ขาตั้งกล้องพร้อมหัวจับ"></div>
    <div class="form-field"><label for="newCategory">หมวดหมู่ *</label><select id="newCategory" name="category" required>${categories}</select></div>
    <div class="form-field"><label for="newPrice">ค่าเช่าต่อวัน (บาท) *</label><input id="newPrice" name="price" type="number" min="1" max="100000" required value="${editItem?.price ?? ''}" placeholder="เช่น 100"></div>
    <div class="form-field"><label for="newDeposit">เงินมัดจำ (บาท) <span class="hint">(ไม่บังคับ)</span></label><input id="newDeposit" name="deposit" type="number" min="0" max="1000000" value="${editItem?.deposit ?? ''}" placeholder="เว้นว่างหากไม่มีเงินมัดจำ"></div>
    <div class="form-field"><label for="newOwner">ชื่อที่แสดง <span class="hint">(ไม่บังคับ)</span></label><input id="newOwner" name="owner" maxlength="30" value="${escapeHTML(editItem?.owner || ownerDefault)}" ${liveMode?'readonly':''} placeholder="เช่น มายด์"><span class="hint">${liveMode?'ใช้ชื่อจากบัญชีที่สมัครไว้':'ชื่อเจ้าของในข้อมูลตัวอย่าง'}</span></div>
    <div class="form-field full"><label for="newLocation">โซนนัดรับโดยประมาณ <span class="hint">(ไม่บังคับ)</span></label><input id="newLocation" name="location" maxlength="100" value="${escapeHTML(editItem?.location || '')}" placeholder="เช่น อาคารกิจกรรมนักศึกษา"></div>
    ${liveMode?`<div class="form-field"><label for="newLatitude">ละติจูดโดยประมาณ (ไม่บังคับ)</label><input id="newLatitude" name="latitude" type="number" min="-90" max="90" step="any" value="${editItem?.latitude ?? ''}" placeholder="เลือกตำแหน่งบนแผนที่"></div><div class="form-field"><label for="newLongitude">ลองจิจูดโดยประมาณ (ไม่บังคับ)</label><input id="newLongitude" name="longitude" type="number" min="-180" max="180" step="any" value="${editItem?.longitude ?? ''}" placeholder="เลือกตำแหน่งบนแผนที่"></div><div class="form-field full"><span class="hint">เลือกจุดรับสาธารณะโดยประมาณ ห้ามปักหมุดที่อยู่บ้าน พิกัดจะถูกปัดให้ใกล้เคียงระดับ 100 เมตรก่อนบันทึก ระบบไม่ขอตำแหน่งอุปกรณ์ของคุณ</span><div id="locationPicker" class="location-picker" aria-label="แผนที่เลือกจุดรับโดยประมาณ"></div></div>`:''}
    <div class="form-field full"><label for="newCondition">สภาพของ <span class="hint">(ไม่บังคับ)</span></label><input id="newCondition" name="condition" maxlength="120" value="${escapeHTML(editItem?.condition || '')}" placeholder="เช่น ใช้งานปกติ มีรอยเล็กน้อย"></div>
    <div class="form-field full"><label for="newDescription">รายละเอียด / อุปกรณ์ที่ให้มาด้วย <span class="hint">(ไม่บังคับ)</span></label><textarea id="newDescription" name="description" maxlength="500" placeholder="แจ้งตำหนิ เงื่อนไข และสิ่งที่ต้องตรวจสอบก่อนรับของ">${escapeHTML(editItem?.description || '')}</textarea></div>
    <div class="form-field full"><label for="newImage">อัปโหลดรูปภาพ (ไม่บังคับ)</label><input id="newImage" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" ${liveMode?'':'disabled'}><span class="hint">ไฟล์ JPG, PNG, WebP หรือ GIF · ขนาดไม่เกิน 5 MB · อัปโหลดเก็บไว้ใน Supabase Storage</span>${liveMode?'':'<span class="hint">ตั้งค่า Supabase ใน .env.local ก่อนใช้งานอัปโหลด</span>'}</div>
  </div><p class="form-footnote">ผู้ลงประกาศรับผิดชอบข้อมูล ราคา เงื่อนไข และความปลอดภัยในการส่งมอบสินค้า</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close">ยกเลิก</button><button type="submit" class="btn btn-primary">${mode === 'edit'?'บันทึกการแก้ไข':liveMode?'บันทึกประกาศ':'เพิ่มรายการตัวอย่าง'}</button></div></form>`);
  if (liveMode) initializeLocationPicker(editItem);
}
async function handleRequestSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if(!data.title.trim() || !data.date || Number(data.budget)<=0 || !data.pickup.trim()) return showToast('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
  if (liveMode) {
    if (!currentSession?.user) return openAuthModal('login');
    const { error } = await supabase.from('wanted_requests').insert({
      owner_id:currentSession.user.id,
      title:data.title.trim(),
      category:data.category,
      budget_per_day:Number(data.budget),
      requested_date:data.date,
      duration:data.duration,
      pickup_zone:data.pickup.trim(),
      details:data.note?.trim() || ''
    });
    if (error) return showToast('เผยแพร่ความต้องการไม่สำเร็จ: ' + friendlyError(error));
    closeModal();
    showToast('เผยแพร่ความต้องการแล้ว นักศึกษาคนอื่นส่งข้อเสนอได้');
    await refreshWantedRequests();
    return;
  }
  const requests=readStore(STORAGE.requests,[]); requests.unshift({...data,id:'req-'+Date.now(),createdAt:new Date().toISOString(),status:'บันทึกในเดโม'}); writeStore(STORAGE.requests,requests); closeModal(); showToast('บันทึกความต้องการในเบราว์เซอร์นี้แล้ว');
}

let wantedRequestCache = [];
async function refreshWantedRequests() {
  const container = $('#wantedRequestsList');
  if (!container) return;
  if (!liveMode) {
    container.innerHTML = '<div class="account-empty">เชื่อมต่อ Supabase เพื่อเผยแพร่และดูความต้องการของนักศึกษาคนอื่น</div>';
    return;
  }
  const { data, error } = await supabase.from('wanted_requests')
    .select('id,owner_id,title,category,budget_per_day,requested_date,duration,pickup_zone,details,created_at,profiles!wanted_requests_owner_id_fkey(full_name)')
    .eq('status', 'open')
    .order('created_at', { ascending:false })
    .limit(30);
  if (error) {
    console.error('โหลดความต้องการไม่สำเร็จ', error);
    container.innerHTML = `<div class="account-empty">โหลดความต้องการไม่ได้: ${escapeHTML(friendlyError(error))}</div>`;
    return;
  }
  wantedRequestCache = data || [];
  if (!wantedRequestCache.length) {
    container.innerHTML = '<div class="account-empty">ยังไม่มีความต้องการที่เปิดรับข้อเสนอ</div>';
    return;
  }
  container.innerHTML = wantedRequestCache.map(request => `<article class="wanted-card">
    <div class="wanted-card-meta"><span>${escapeHTML(categoryLabels[request.category] || 'อื่น ๆ')}</span><time>${formatDateThai(String(request.created_at || '').slice(0,10))}</time></div>
    <h3>${escapeHTML(request.title)}</h3><p>${escapeHTML(request.details || 'ยังไม่มีรายละเอียดเพิ่มเติม')}</p>
    <dl><div><dt>งบต่อวัน</dt><dd>฿${formatBaht(request.budget_per_day)}</dd></div><div><dt>วันที่ต้องการ</dt><dd>${formatDateThai(request.requested_date)} · ${escapeHTML(request.duration)}</dd></div><div><dt>โซนรับ</dt><dd>${escapeHTML(request.pickup_zone)}</dd></div></dl>
    <div class="wanted-card-footer"><span>โดย ${escapeHTML(request.profiles?.full_name || 'สมาชิก')}</span>${request.owner_id === currentSession?.user?.id ? '<span class="status-pill">คำขอของคุณ</span>' : `<button class="btn btn-primary" data-action="offer-request" data-id="${escapeHTML(request.id)}">ส่งข้อเสนอ</button>`}</div>
  </article>`).join('');
}

async function openOfferForm(requestId) {
  if (!currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนส่งข้อเสนอ'); }
  const request = wantedRequestCache.find(item => item.id === requestId);
  if (!request) return showToast('ไม่พบความต้องการนี้ กรุณาโหลดรายการใหม่');
  if (request.owner_id === currentSession.user.id) return showToast('คุณไม่สามารถส่งข้อเสนอให้คำขอของตัวเองได้');
  const { data:listings, error } = await supabase.from('listings')
    .select('id,title,price_per_day')
    .eq('owner_id', currentSession.user.id)
    .eq('is_available', true)
    .order('created_at', { ascending:false });
  if (error) return showToast('โหลดประกาศของคุณไม่สำเร็จ: ' + friendlyError(error));
  const options = (listings || []).map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)} · ฿${formatBaht(item.price_per_day)}/วัน</option>`).join('');
  openModal('ส่งข้อเสนอ', `สำหรับ: ${request.title}`, `<form id="offerForm" data-id="${escapeHTML(request.id)}">
    <div class="form-field"><label for="offerListing">ประกาศสินค้าที่เกี่ยวข้อง (ไม่บังคับ)</label><select id="offerListing" name="listing_id"><option value="">ยังไม่มีประกาศสินค้า</option>${options}</select><span class="hint">เลือกได้เฉพาะประกาศที่คุณเป็นเจ้าของและเปิดให้เช่า</span></div>
    <div class="form-field"><label for="offerMessage">ข้อความถึงผู้ตามหา *</label><textarea id="offerMessage" name="message" required maxlength="500" placeholder="แจ้งรายละเอียดสินค้าและเงื่อนไขที่เสนอ"></textarea></div>
    <div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close">ยกเลิก</button><button class="btn btn-primary" type="submit">ส่งข้อเสนอ</button></div>
  </form>`);
}

async function handleOfferSubmit(form) {
  if (!currentSession?.user) return openAuthModal('login');
  const data = Object.fromEntries(new FormData(form).entries());
  const { error } = await supabase.from('wanted_offers').insert({
    wanted_request_id:form.dataset.id,
    offerer_id:currentSession.user.id,
    listing_id:data.listing_id || null,
    message:data.message.trim()
  });
  if (error) return showToast('ส่งข้อเสนอไม่สำเร็จ: ' + friendlyError(error));
  closeModal();
  showToast('ส่งข้อเสนอแล้ว เจ้าของคำขอจะได้รับแจ้งเตือน');
}

async function importLegacyWantedRequests(userId) {
  if (!userId) return;
  const saved = readStore(STORAGE.requests, []);
  if (!Array.isArray(saved) || !saved.length) return;
  const key = `csh_wanted_imported_${userId}`;
  const imported = new Set(readStore(key, []));
  const pending = saved.filter(item => item?.id && !imported.has(item.id) && item.title && item.date && item.pickup);
  if (!pending.length) return;
  const { error } = await supabase.from('wanted_requests').insert(pending.map(item => ({
    owner_id:userId,
    title:String(item.title).slice(0,100),
    category:categoryLabels[item.category] ? item.category : 'other',
    budget_per_day:Number(item.budget),
    requested_date:item.date,
    duration:String(item.duration || 'ไม่ระบุ').slice(0,80),
    pickup_zone:String(item.pickup).slice(0,100),
    details:String(item.note || item.contact || '').slice(0,500)
  })));
  if (error) {
    console.warn('นำเข้าความต้องการเดิมไม่สำเร็จ', error);
    showToast('นำเข้าความต้องการเดิมไม่สำเร็จ: ' + friendlyError(error));
    return;
  }
  writeStore(key, [...imported, ...pending.map(item => item.id)]);
  showToast(`นำเข้าความต้องการเดิม ${pending.length} รายการแล้ว โดยยังเก็บข้อมูลต้นฉบับไว้ในเครื่อง`);
  await refreshWantedRequests();
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' });
}
function notificationGroupLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ก่อนหน้านี้';
  const startOfToday = new Date();
  startOfToday.setHours(0,0,0,0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0,0,0,0);
  const dayDifference = Math.round((startOfToday - startOfDate) / 86400000);
  if (dayDifference === 0) return 'วันนี้';
  if (dayDifference === 1) return 'เมื่อวาน';
  return date.toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' });
}

async function openConversationForListing(listingId) {
  if (!currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนเริ่มแชต'); }
  const { data, error } = await supabase.rpc('start_listing_conversation', { p_listing_id:listingId });
  if (error) return showToast('เปิดแชตไม่สำเร็จ: ' + friendlyError(error));
  await openConversation(data.id);
}

async function openConversationForBooking(bookingId) {
  if (!currentSession?.user) { openAuthModal('login'); return showToast('เข้าสู่ระบบก่อนเริ่มแชต'); }
  const { data, error } = await supabase.rpc('start_booking_conversation', { p_booking_id:bookingId });
  if (error) return showToast('เปิดแชตจากการจองไม่สำเร็จ: ' + friendlyError(error));
  await openConversation(data.id);
}

async function loadConversationMessages(conversationId) {
  if (!currentSession?.user || activeConversation !== conversationId) return;
  const messages = $('#messageList');
  if (!messages) return;
  const { data, error } = await supabase.from('messages')
    .select('id,sender_id,body,created_at,profiles!messages_sender_id_fkey(full_name)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending:true })
    .limit(100);
  if (error) {
    messages.innerHTML = `<div class="account-empty">โหลดข้อความไม่ได้: ${escapeHTML(friendlyError(error))}</div>`;
    return;
  }
  if (!data?.length) {
    messages.innerHTML = '<div class="account-empty">เริ่มบทสนทนาได้ด้วยการส่งข้อความ</div>';
    return;
  }
  messages.innerHTML = data.map(message => `<article class="message ${message.sender_id === currentSession.user.id ? 'mine' : ''}">
    <div class="message-meta"><strong>${escapeHTML(message.profiles?.full_name || 'สมาชิก')}</strong><time>${formatTime(message.created_at)}</time></div>
    <p>${escapeHTML(message.body)}</p>
  </article>`).join('');
  messages.scrollTop = messages.scrollHeight;
}

async function openConversation(conversationId) {
  if (!currentSession?.user) return openAuthModal('login');
  const { data:conversation, error } = await supabase.from('conversations')
    .select('id,listing_id,requester_id,owner_id,listings!conversations_listing_id_fkey(title)')
    .eq('id', conversationId).maybeSingle();
  if (error) return showToast('โหลดบทสนทนาไม่สำเร็จ: ' + friendlyError(error));
  if (!conversation) return showToast('ไม่พบบทสนทนานี้หรือคุณไม่มีสิทธิ์เข้าถึง');
  const participantId = conversation.requester_id === currentSession.user.id ? conversation.owner_id : conversation.requester_id;
  const { data:profile, error:profileError } = await supabase.from('profiles')
    .select('full_name').eq('id', participantId).maybeSingle();
  if (profileError) return showToast('โหลดข้อมูลคู่สนทนาไม่สำเร็จ: ' + friendlyError(profileError));
  activeConversation = conversationId;
  openModal(profile?.full_name || 'แชตกับเจ้าของ', conversation.listings?.title || 'บทสนทนาเกี่ยวกับประกาศ', `<div class="chat-shell">
    <div id="messageList" class="message-list" aria-live="polite"><div class="account-empty">กำลังโหลดข้อความ…</div></div>
    <form id="messageForm" data-id="${escapeHTML(conversationId)}" class="message-form"><textarea name="body" maxlength="2000" required aria-label="ข้อความ" placeholder="เขียนข้อความถึงคู่สนทนา"></textarea><button class="btn btn-primary" type="submit">ส่งข้อความ</button></form>
    <p class="form-footnote">ส่งข้อความระหว่างบัญชีที่เป็นคู่สนทนาเท่านั้น</p>
  </div>`, true);
  const { error:readError } = await supabase.rpc('mark_conversation_read', { p_conversation_id:conversationId });
  if (readError) console.warn('ทำเครื่องหมายแชตว่าอ่านแล้วไม่สำเร็จ', readError);
  await loadConversationMessages(conversationId);
  await refreshConversationList();
  if (conversationChannel) await supabase.removeChannel(conversationChannel);
  conversationChannel = supabase.channel(`conversation-${conversationId}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`conversation_id=eq.${conversationId}` }, () => {
      void loadConversationMessages(conversationId);
      void supabase.rpc('mark_conversation_read', { p_conversation_id:conversationId });
      void refreshConversationList();
    })
    .subscribe();
  if (conversationRecoveryTimer) clearInterval(conversationRecoveryTimer);
  conversationRecoveryTimer = setInterval(() => {
    if (activeConversation === conversationId) void loadConversationMessages(conversationId);
  }, 12000);
}

async function sendMessage(form) {
  if (!currentSession?.user) return openAuthModal('login');
  const body = String(new FormData(form).get('body') || '').trim();
  if (!body) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const { error } = await supabase.from('messages').insert({
    conversation_id:form.dataset.id,
    sender_id:currentSession.user.id,
    body
  });
  button.disabled = false;
  if (error) return showToast('ส่งข้อความไม่สำเร็จ: ' + friendlyError(error));
  form.reset();
  await loadConversationMessages(form.dataset.id);
  await refreshNotificationCount();
}

async function refreshConversationList() {
  const out = $('#accountContent');
  if (!currentSession?.user) return;
  const uid = currentSession.user.id;
  const { data, error } = await supabase.from('conversations')
    .select('id,listing_id,requester_id,owner_id,last_message,last_message_at,created_at,listings!conversations_listing_id_fkey(title)')
    .or(`requester_id.eq.${uid},owner_id.eq.${uid}`)
    .order('last_message_at', { ascending:false, nullsFirst:false });
  if (error) {
    if (out && accountTab === 'inbox') out.innerHTML = `<div class="account-empty">โหลดกล่องข้อความไม่ได้: ${escapeHTML(friendlyError(error))}</div>`;
    return;
  }
  const conversations = data || [];
  if (!conversations.length) {
    if (out && accountTab === 'inbox') out.innerHTML = '<div class="account-empty">ยังไม่มีบทสนทนา เริ่มจากปุ่ม “แชตกับเจ้าของ” ในหน้ารายละเอียดประกาศ</div>';
    return;
  }
  const unreadResults = await Promise.all(conversations.map(async item => {
    const result = await supabase.rpc('conversation_unread_count', { p_conversation_id:item.id });
    return { id:item.id, count:Number(result.data || 0), error:result.error };
  }));
  const unreadFailure = unreadResults.find(result => result.error);
  if (unreadFailure) {
    console.error('โหลดจำนวนข้อความที่ยังไม่อ่านไม่สำเร็จ', unreadFailure.error);
    const message = 'โหลดจำนวนข้อความที่ยังไม่อ่านไม่ได้: ' + friendlyError(unreadFailure.error);
    if (out && accountTab === 'inbox') out.innerHTML = `<div class="account-empty">${escapeHTML(message)}</div>`;
    else showToast(message);
    return;
  }
  const countById = Object.fromEntries(unreadResults.map(result => [result.id, result.count]));
  const participantIds = [...new Set(conversations.map(item => item.requester_id === uid ? item.owner_id : item.requester_id))];
  const { data:profiles, error:profileError } = await supabase.from('profiles').select('id,full_name').in('id', participantIds);
  if (profileError) {
    if (out && accountTab === 'inbox') out.innerHTML = `<div class="account-empty">โหลดชื่อผู้สนทนาไม่ได้: ${escapeHTML(friendlyError(profileError))}</div>`;
    return;
  }
  const names = Object.fromEntries((profiles || []).map(profile => [profile.id, profile.full_name]));
  if (out && accountTab === 'inbox') out.innerHTML = `<div class="account-list">${conversations.map(item => {
    const other = item.requester_id === uid ? item.owner_id : item.requester_id;
    const unread = countById[item.id] || 0;
    return `<button class="conversation-row ${unread?'unread':''}" data-action="open-conversation" data-id="${escapeHTML(item.id)}">
      <span class="conversation-initial">${escapeHTML((names[other] || 'ส').slice(0,1))}</span>
      <span class="conversation-copy"><strong>${escapeHTML(names[other] || 'สมาชิก')}</strong><small>${escapeHTML(item.listings?.title || 'ประกาศ')}</small><span>${escapeHTML(item.last_message || 'เริ่มการสนทนา')}</span></span>
      <span class="conversation-side"><time>${formatTime(item.last_message_at || item.created_at)}</time>${unread?`<b>${unread}</b>`:''}</span>
    </button>`;
  }).join('')}</div>`;
}

async function openInbox() {
  if (!currentSession?.user) return openAuthModal('login');
  accountTab = 'inbox';
  openModal('ข้อความ', 'บทสนทนาส่วนตัวเกี่ยวกับประกาศเช่า', `<div id="accountContent"><div class="account-empty">กำลังโหลดข้อความ…</div></div>`, true);
  await refreshConversationList();
}

async function refreshNotificationCount(showError = false) {
  if (!currentSession?.user) return;
  const { count, error } = await supabase.from('notifications')
    .select('id', { count:'exact', head:true })
    .eq('recipient_id', currentSession.user.id)
    .is('read_at', null);
  if (error) {
    console.error('โหลดจำนวนแจ้งเตือนไม่สำเร็จ', error);
    if (showError) showToast('โหลดการแจ้งเตือนไม่สำเร็จ: ' + friendlyError(error));
    return;
  }
  const badge = $('#notificationCount');
  const unreadCount = Number(count || 0);
  badge.dataset.unread = String(unreadCount);
  badge.textContent = String(unreadCount);
  badge.hidden = unreadCount === 0;
}

async function openNotifications() {
  if (!currentSession?.user) return openAuthModal('login');
  openModal('การแจ้งเตือน', 'อัปเดตเกี่ยวกับการจอง แชต และข้อเสนอ', '<div id="notificationList"><div class="account-empty">กำลังโหลดการแจ้งเตือน…</div></div>', true);
  const list = $('#notificationList');
  const { data, error } = await supabase.from('notifications')
    .select('id,actor_id,kind,title,body,link_type,link_id,read_at,created_at')
    .eq('recipient_id', currentSession.user.id)
    .order('created_at', { ascending:false }).range(0, NOTIFICATION_PAGE_SIZE - 1);
  if (error) {
    list.innerHTML = `<div class="account-empty">โหลดการแจ้งเตือนไม่ได้: ${escapeHTML(friendlyError(error))}</div>`;
    return;
  }
  notificationCache = data || [];
  notificationOffset = notificationCache.length;
  renderNotificationPanel(notificationCache.length === NOTIFICATION_PAGE_SIZE);
  await refreshNotificationCount();
}

function renderNotificationPanel(hasMore) {
  const list = $('#notificationList');
  if (!list) return;
  const unread = notificationCache.filter(item => !item.read_at);
  const groups = [];
  for (const item of notificationCache) {
    const label = notificationGroupLabel(item.created_at);
    let group = groups.find(entry => entry.label === label);
    if (!group) { group = { label, items:[] }; groups.push(group); }
    group.items.push(item);
  }
  list.innerHTML = `<div class="notification-actions"><span>${unread.length} รายการยังไม่อ่าน · แสดง ${notificationCache.length} รายการ</span><button class="btn btn-secondary" data-action="mark-notifications-read" ${unread.length?'':'disabled'}>ทำเครื่องหมายว่าอ่านทั้งหมด</button></div>${notificationCache.length ? `<div class="notification-groups">${groups.map(group => `<section><h3>${escapeHTML(group.label)}</h3><div class="notification-list">${group.items.map(item => `<button class="notification-item ${item.read_at?'':'unread'}" data-action="notification-link" data-id="${escapeHTML(item.id)}">
    <span class="notification-dot" aria-hidden="true"></span><span><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.body)}</small><time>${formatTime(item.created_at)}</time></span>
  </button>`).join('')}</div></section>`).join('')}</div>${hasMore?'<button class="btn btn-secondary notification-more" data-action="load-more-notifications">โหลดการแจ้งเตือนเก่ากว่า</button>':''}` : '<div class="account-empty">ยังไม่มีการแจ้งเตือน</div>'}`;
}

async function loadMoreNotifications() {
  if (!currentSession?.user) return;
  const { data, error } = await supabase.from('notifications')
    .select('id,actor_id,kind,title,body,link_type,link_id,read_at,created_at')
    .eq('recipient_id', currentSession.user.id)
    .order('created_at', { ascending:false })
    .range(notificationOffset, notificationOffset + NOTIFICATION_PAGE_SIZE - 1);
  if (error) return showToast('โหลดรายการแจ้งเตือนเพิ่มเติมไม่ได้: ' + friendlyError(error));
  notificationCache.push(...(data || []));
  notificationOffset += data?.length || 0;
  renderNotificationPanel(data?.length === NOTIFICATION_PAGE_SIZE);
}

async function markNotificationsRead() {
  if (!currentSession?.user) return;
  const { error } = await supabase.from('notifications')
    .update({ read_at:new Date().toISOString() })
    .eq('recipient_id', currentSession.user.id)
    .is('read_at', null);
  if (error) return showToast('ทำเครื่องหมายว่าอ่านแล้วไม่สำเร็จ: ' + friendlyError(error));
  showToast('ทำเครื่องหมายการแจ้งเตือนว่าอ่านแล้ว');
  await openNotifications();
}

async function openNotificationTarget(notificationId) {
  const item = notificationCache.find(notification => notification.id === notificationId);
  if (!item) return;
  const { error } = await supabase.from('notifications').update({ read_at:new Date().toISOString() })
    .eq('id', item.id).eq('recipient_id', currentSession.user.id);
  if (error) return showToast('อัปเดตการแจ้งเตือนไม่สำเร็จ: ' + friendlyError(error));
  await refreshNotificationCount();
  if (item.link_type === 'conversation') return openConversation(item.link_id);
  if (item.link_type === 'listing') { closeModal(); return listingDetail(item.link_id); }
  if (item.link_type === 'booking') {
    const { data:booking, error:bookingError } = await supabase.from('bookings').select('renter_id,listing_id').eq('id', item.link_id).maybeSingle();
    if (bookingError) return showToast('เปิดการจองไม่ได้: ' + friendlyError(bookingError));
    if (!booking) return showToast('ไม่พบคำขอจองนี้');
    const { data:listing, error:listingError } = await supabase.from('listings').select('owner_id').eq('id', booking.listing_id).maybeSingle();
    if (listingError) return showToast('ตรวจสอบผู้ดูแลประกาศไม่ได้: ' + friendlyError(listingError));
    return openAccountDashboard(booking.renter_id === currentSession.user.id ? 'as-renter' : listing?.owner_id === currentSession.user.id ? 'as-owner' : 'admin-bookings');
  }
  if (item.link_type === 'offer') return openOfferNotification(item.link_id, item);
  if (item.link_type === 'wanted_request') return openAccountDashboard('my-wanted');
}

async function openOfferNotification(offerId, notification = null) {
  const { data:offer, error } = await supabase.from('wanted_offers')
    .select('id,wanted_request_id,offerer_id,listing_id,message,status,created_at,profiles!wanted_offers_offerer_id_fkey(full_name),wanted_requests!wanted_offers_wanted_request_id_fkey(title,owner_id)')
    .eq('id', offerId).maybeSingle();
  if (error) return showToast('เปิดข้อเสนอไม่ได้: ' + friendlyError(error));
  if (!offer) return showToast('ไม่พบข้อเสนอนี้หรือไม่มีสิทธิ์เข้าถึง');
  let listing = null;
  if (offer.listing_id) {
    const result = await supabase.from('listings').select('id,title,owner_id').eq('id', offer.listing_id).maybeSingle();
    if (result.error) return showToast('โหลดประกาศในข้อเสนอไม่ได้: ' + friendlyError(result.error));
    listing = result.data;
  }
  const ownsRequest = offer.wanted_requests?.owner_id === currentSession.user.id;
  const controls = ownsRequest && offer.status === 'pending'
    ? `<button class="btn btn-primary" data-action="offer-accept" data-id="${escapeHTML(offer.id)}">ตอบรับข้อเสนอ</button><button class="btn btn-danger" data-action="offer-decline" data-id="${escapeHTML(offer.id)}">ปฏิเสธ</button>`
    : '';
  const offerStatus = notification?.kind === 'request_closed'
    ? 'คำขอปิดรับข้อเสนอแล้ว'
    : offer.status==='pending'?'รอตอบรับ':offer.status==='accepted'?'ตอบรับแล้ว':'ปฏิเสธแล้ว';
  openModal('รายละเอียดข้อเสนอ', offer.wanted_requests?.title || notification?.body || 'ความต้องการ', `<div class="offer-detail">
    <p><strong>ผู้เสนอ:</strong> ${escapeHTML(offer.profiles?.full_name || 'สมาชิก')}</p>
    <p><strong>ข้อความ:</strong> ${escapeHTML(offer.message)}</p>
    <p><strong>สถานะ:</strong> ${offerStatus}</p>
    ${listing?`<p><strong>ประกาศที่แนบมา:</strong> <button class="text-action" data-action="open-listing-detail" data-id="${escapeHTML(listing.id)}">${escapeHTML(listing.title)}</button></p>${ownsRequest?`<button class="btn btn-secondary" data-action="offer-chat" data-listing-id="${escapeHTML(listing.id)}">แชตกับผู้เสนอ</button>`:''}`:'<p class="form-footnote">ผู้เสนอไม่ได้แนบประกาศสินค้า จึงยังเปิดหน้าประกาศหรือเริ่มแชตจากข้อเสนอนี้ไม่ได้</p>'}
    <div class="form-actions">${controls}<button class="btn btn-secondary" data-action="close">ปิด</button></div>
  </div>`, true);
}

function startRealtime(userId) {
  if (!liveMode || !userId) return;
  realtimeChannels.forEach(channel => void supabase.removeChannel(channel));
  realtimeChannels = [];
  const notifications = supabase.channel(`notifications-${userId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'notifications', filter:`recipient_id=eq.${userId}` }, () => {
      void refreshNotificationCount();
      if ($('#notificationList') && $('#modalBackdrop').classList.contains('open') && $('#modalTitle').textContent === 'การแจ้งเตือน') {
        void openNotifications();
      }
    }).subscribe();
  realtimeChannels.push(notifications);
  if (notificationRecoveryTimer) clearInterval(notificationRecoveryTimer);
  notificationRecoveryTimer = setInterval(() => {
    if (currentSession?.user?.id === userId) void refreshNotificationCount();
  }, 20000);
  void refreshNotificationCount();
}

function stopRealtime() {
  realtimeChannels.forEach(channel => void supabase.removeChannel(channel));
  realtimeChannels = [];
  if (conversationChannel) void supabase.removeChannel(conversationChannel);
  conversationChannel = null;
  if (conversationRecoveryTimer) clearInterval(conversationRecoveryTimer);
  if (notificationRecoveryTimer) clearInterval(notificationRecoveryTimer);
  activeConversation = null;
}
async function handleListingSubmit(form) {
  const mode = form.dataset.mode;
  if (mode !== 'create' && mode !== 'edit') return showToast('ไม่ทราบประเภทการบันทึกประกาศ กรุณาปิดแล้วเปิดฟอร์มใหม่');
  const data = Object.fromEntries(new FormData(form).entries());
  const title = String(data.title || '').trim();
  const category = String(data.category || '');
  const price = Number(data.price);
  const depositText = String(data.deposit || '').trim();
  const deposit = depositText ? Number(depositText) : 0;
  const location = String(data.location || '').trim() || null;
  const condition = String(data.condition || '').trim() || null;
  const description = String(data.description || '').trim() || null;
  const latitudeText = String(data.latitude || '').trim();
  const longitudeText = String(data.longitude || '').trim();
  const hasLatitude = latitudeText !== '';
  const hasLongitude = longitudeText !== '';
  const imageFile = data.image instanceof File && data.image.size ? data.image : null;
  if (title.length < 2 || title.length > 100 || !categoryLabels[category] || !Number.isFinite(price) || price <= 0 || price > 100000) {
    return showToast('กรุณาระบุชื่อสิ่งของ หมวดหมู่ และค่าเช่าต่อวันให้ถูกต้อง');
  }
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > 1000000) return showToast('จำนวนเงินมัดจำไม่ถูกต้อง');
  if ((hasLatitude && !hasLongitude) || (!hasLatitude && hasLongitude)) return showToast('กรุณากรอกพิกัดทั้งละติจูดและลองจิจูด หรือเว้นว่างทั้งคู่');
  if (hasLatitude) {
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return showToast('พิกัดจุดรับไม่ถูกต้อง');
    }
  }
  if (imageFile && !liveMode) return showToast('การอัปโหลดรูปถาวรต้องเชื่อมต่อ Supabase ก่อน');
  if (liveMode) {
    if (!currentSession?.user) return openAuthModal('login');
    if (mode === 'edit' && !form.dataset.id) return showToast('ไม่พบรหัสประกาศที่ต้องการแก้ไข');
    let uploaded = { url: null, path: null };
    const removeUploadedImage = async () => {
      if (!uploaded.path) return;
      const { error } = await supabase.storage.from(LISTING_IMAGE_BUCKET).remove([uploaded.path]);
      if (error) console.warn('ลบรูปที่อัปโหลดระหว่างบันทึกไม่สำเร็จ', error);
    };
    try {
      if (imageFile) uploaded = await uploadListingImage(imageFile);
      const payload = {
        title, category, price_per_day:price, deposit, location, condition, description,
        pickup_latitude:hasLatitude ? Number(latitudeText) : null,
        pickup_longitude:hasLongitude ? Number(longitudeText) : null
      };
      if (uploaded.url) {
        payload.image_url = uploaded.url;
        payload.image_path = uploaded.path;
      }
      let query;
      if (mode === 'edit') {
        query = supabase.from('listings').update(payload).eq('id', form.dataset.id);
        if (!currentIsAdmin) query = query.eq('owner_id', currentSession.user.id);
      } else {
        query = supabase.from('listings').insert({
          ...payload, owner_id:currentSession.user.id, image_url:uploaded.url,
          image_path:uploaded.path, is_available:true
        });
      }
      const { data: savedRow, error } = await query.select('id').maybeSingle();
      if (error) {
        await removeUploadedImage();
        return showToast('บันทึกประกาศไม่สำเร็จ: ' + friendlyError(error));
      }
      if (!savedRow) {
        await removeUploadedImage();
        return showToast(mode === 'edit'
          ? 'ไม่สามารถแก้ไขประกาศนี้ได้ อาจไม่มีสิทธิ์หรือประกาศถูกลบแล้ว'
          : 'สร้างประกาศไม่สำเร็จ ฐานข้อมูลไม่ส่งรายการที่บันทึกกลับมา');
      }
      if (mode === 'edit' && uploaded.path && form.dataset.imagePath) {
        const removed = await supabase.storage.from(LISTING_IMAGE_BUCKET).remove([form.dataset.imagePath]);
        if (removed.error) console.warn('ลบรูปเก่าไม่สำเร็จ', removed.error);
      }
      await refreshListings();
      closeModal();
      if (mode === 'edit') {
        await renderAccountTab(accountTab);
        showToast('บันทึกการแก้ไขประกาศแล้ว');
        return;
      }
      const savedListing = listingCache.find(item => item.id === savedRow.id);
      if (savedListing) listingDetail(savedRow.id);
      else openAccountDashboard('my-listings');
      showToast('ลงประกาศสำเร็จแล้ว');
      return;
    } catch (error) {
      await removeUploadedImage();
      showToast('บันทึกประกาศไม่สำเร็จ: ' + friendlyError(error));
      return;
    }
  }
  if (mode === 'edit' && !getListings().some(item => item.id === form.dataset.id)) return showToast('ไม่พบประกาศที่ต้องการแก้ไข');
  const owner = String(data.owner || '').trim() || 'สมาชิก';
  const existingItem = getListings().find(item => item.id === form.dataset.id);
  const newItem = {
    id:mode === 'edit' ? form.dataset.id : 'user-' + Date.now(),
    owner, title, category, categoryLabel:categoryLabels[category] || 'อื่น ๆ',
    price, deposit, location, condition, description,
    initial:owner.slice(0,1), tag:'ประกาศใหม่ · เดโม',
    image:existingItem?.image || 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',
    available:existingItem?.available ?? true
  };
  const all = getListings();
  const existingIndex = all.findIndex(item => item.id === newItem.id);
  if (existingIndex >= 0) all[existingIndex] = { ...all[existingIndex], ...newItem };
  else all.unshift(newItem);
  writeStore(STORAGE.listings, all);
  renderListings();
  closeModal();
  listingDetail(newItem.id);
  showToast(mode === 'edit' ? 'บันทึกการแก้ไขประกาศแล้ว' : 'เพิ่มประกาศตัวอย่างในเบราว์เซอร์นี้แล้ว');
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
      applyAuthSession(result.data.session); closeModal(); showToast('สมัครสมาชิกสำเร็จ'); await refreshListings(); return;
    }
    result = await supabase.auth.signInWithPassword({email:data.email.trim(),password:data.password});
    if (result.error) throw result.error;
    applyAuthSession(result.data.session); closeModal(); showToast('เข้าสู่ระบบสำเร็จ'); await refreshListings();
  } catch (error) {
    const target = $('#authError'); if (target) target.textContent = friendlyError(error);
  } finally {
    const liveButton = $('#authForm button[type="submit"]'); if (liveButton) { liveButton.disabled=false; liveButton.textContent=$('#authForm').dataset.mode==='signup'?'สร้างบัญชี':'เข้าสู่ระบบ'; }
  }
}

function statusText(status) { return ({pending:'รออนุมัติ',approved:'อนุมัติแล้ว',rejected:'ปฏิเสธ',cancelled:'ยกเลิก',completed:'เสร็จสิ้น'})[status] || status; }
function accountShell(tab) {
  const tabs = currentIsAdmin
    ? [['admin-overview','ภาพรวมแอดมิน'],['admin-listings','ประกาศทั้งหมด'],['admin-bookings','การจองทั้งหมด'],['admin-users','สมาชิกทั้งหมด'],['my-listings','ประกาศของฉัน'],['as-renter','รายการที่ฉันจอง'],['as-owner','คำขอที่ได้รับ'],['my-wanted','ความต้องการของฉัน'],['incoming-offers','ข้อเสนอที่ได้รับ'],['inbox','ข้อความ']]
    : [['my-listings','ประกาศของฉัน'],['as-renter','รายการที่ฉันจอง'],['as-owner','คำขอที่ได้รับ'],['my-wanted','ความต้องการของฉัน'],['incoming-offers','ข้อเสนอที่ได้รับ'],['inbox','ข้อความ']];
  return `<div class="account-tabs">${tabs.map(([key,label])=>`<button class="account-tab ${tab===key?'active':''}" data-action="account-tab" data-tab="${key}" aria-pressed="${tab===key}">${label}</button>`).join('')}<button class="account-tab" data-action="logout">ออกจากระบบ</button></div><div id="accountContent"><div class="account-empty">กำลังโหลดข้อมูล…</div></div>`;
}
function openAccountDashboard(tab=currentIsAdmin?'admin-overview':'my-listings') {
  if (!liveMode) return openAuthModal('login');
  if (!currentSession?.user) return openAuthModal('login');
  accountTab = tab;
  const name = currentProfile?.full_name || currentSession.user.user_metadata?.full_name || currentSession.user.email || 'สมาชิก';
  openModal(currentIsAdmin ? 'แผงควบคุมแอดมิน' : 'บัญชีของฉัน', `สวัสดี ${name} · ${currentIsAdmin?'จัดการข้อมูลแพลตฟอร์ม':'จัดการประกาศและคำขอจอง'}`, accountShell(tab), true);
  renderAccountTab(tab);
}
async function renderAdminTab(tab, out) {
  if (!currentIsAdmin) { out.innerHTML='<div class="account-empty">บัญชีนี้ไม่มีสิทธิ์แอดมิน</div>'; return; }
  if (tab === 'admin-overview') {
    const [users, listings, bookings] = await Promise.all([
      supabase.from('profiles').select('id',{count:'exact',head:true}),
      supabase.from('listings').select('id',{count:'exact',head:true}),
      supabase.from('bookings').select('id',{count:'exact',head:true})
    ]);
    for (const result of [users,listings,bookings]) if (result.error) throw result.error;
    out.innerHTML = `<div class="admin-stat-grid"><div class="admin-stat"><span>สมาชิก</span><strong>${users.count||0}</strong></div><div class="admin-stat"><span>ประกาศทั้งหมด</span><strong>${listings.count||0}</strong></div><div class="admin-stat"><span>คำขอจองทั้งหมด</span><strong>${bookings.count||0}</strong></div></div><div class="account-row admin-welcome"><div><h3>ยินดีต้อนรับผู้ดูแลระบบ</h3><p>บัญชีแอดมินสามารถตรวจสอบสมาชิก ประกาศ และคำขอจองทั้งหมดที่บันทึกไว้ใน Supabase ได้</p><p>สิทธิ์ถูกตรวจสอบจากฐานข้อมูล ไม่ได้อาศัยชื่อที่แสดงบนหน้าเว็บ</p></div></div><div class="admin-shortcuts"><button class="btn btn-secondary" data-action="account-tab" data-tab="admin-listings">จัดการประกาศทั้งหมด</button><button class="btn btn-secondary" data-action="account-tab" data-tab="admin-bookings">ตรวจสอบการจอง</button><button class="btn btn-secondary" data-action="account-tab" data-tab="admin-users">ดูข้อมูลสมาชิก</button></div>`;
    return;
  }
  if (tab === 'admin-listings') {
    const {data,error}=await supabase.from('listings').select('*, profiles!listings_owner_id_fkey(full_name)').order('created_at',{ascending:false});
    if(error) throw error;
    if(!data?.length){out.innerHTML='<div class="account-empty">ยังไม่มีประกาศในระบบ</div>';return;}
    out.innerHTML=`<div class="account-list">${data.map(row=>`<div class="account-row"><div><h3>${escapeHTML(row.title)}</h3><p>ผู้ลงประกาศ: ${escapeHTML(row.profiles?.full_name||'สมาชิก')} · ${escapeHTML(row.location||'ยังไม่ได้ระบุตำแหน่ง')} · ฿${formatBaht(row.price_per_day)} / วัน</p><p><span class="status-pill ${row.is_available?'approved':'cancelled'}">${row.is_available?'เปิดให้เช่า':'ซ่อนประกาศ'}</span> · ${formatDateThai(String(row.created_at||'').slice(0,10))}</p></div><div class="account-actions"><button class="btn btn-secondary" data-action="edit-listing" data-id="${row.id}">แก้ไข</button><button class="btn btn-secondary" data-action="toggle-listing" data-id="${row.id}" data-available="${row.is_available}">${row.is_available?'ซ่อนประกาศ':'เปิดให้เช่า'}</button><button class="btn btn-danger" data-action="delete-listing" data-id="${row.id}">ลบ</button></div></div>`).join('')}</div>`;
    return;
  }
  if (tab === 'admin-users') {
    const {data,error}=await supabase.rpc('admin_list_users');
    if(error) throw error;
    if(!data?.length){out.innerHTML='<div class="account-empty">ยังไม่พบข้อมูลสมาชิก</div>';return;}
    out.innerHTML=`<div class="account-list">${data.map(user=>`<div class="account-row"><div><h3>${escapeHTML(user.full_name||'สมาชิก')}</h3><p>อีเมล: ${escapeHTML(user.email||'-')}</p><p>สถานศึกษา: ${escapeHTML(user.university||'-')}</p><p>สมัครเมื่อ ${formatDateThai(String(user.created_at||'').slice(0,10))} · ${user.is_admin?'<span class="status-pill approved">แอดมิน</span>':'<span class="status-pill">สมาชิก</span>'}</p></div></div>`).join('')}</div>`;
    return;
  }
  if (tab === 'admin-bookings') {
    const {data:rows,error}=await supabase.from('bookings').select('*').order('created_at',{ascending:false});
    if(error) throw error;
    if(!rows?.length){out.innerHTML='<div class="account-empty">ยังไม่มีคำขอจองในระบบ</div>';return;}
    const itemIds=[...new Set(rows.map(row=>row.listing_id))];
    const userIds=[...new Set(rows.map(row=>row.renter_id))];
    const [{data:listings,error:listError},{data:profiles,error:profilesError},{data:users,error:usersError}]=await Promise.all([
      supabase.from('listings').select('id,title,owner_id,location').in('id',itemIds),
      supabase.from('profiles').select('id,full_name').in('id',userIds),
      supabase.rpc('admin_list_users')
    ]);
    if(listError) throw listError; if(profilesError) throw profilesError; if(usersError) throw usersError;
    const itemMap=Object.fromEntries((listings||[]).map(item=>[item.id,item]));
    const profileMap=Object.fromEntries((profiles||[]).map(user=>[user.id,user.full_name]));
    const userMap=Object.fromEntries((users||[]).map(user=>[user.user_id,user]));
    out.innerHTML=`<div class="account-list">${rows.map(row=>{const item=itemMap[row.listing_id]||{};const renter=userMap[row.renter_id]||{};return `<div class="account-row"><div><h3>${escapeHTML(item.title||'ประกาศที่ถูกลบ')}</h3><p>ผู้จอง: ${escapeHTML(profileMap[row.renter_id]||renter.full_name||'สมาชิก')} · ${escapeHTML(renter.email||'-')}</p><p>วันเช่า: ${formatDateThai(row.start_date)} – ${formatDateThai(row.end_date)} · จุดรับ: ${escapeHTML(row.pickup_location||'-')}</p><p>ค่าเช่ารวม ฿${formatBaht(row.total_price)} · <span class="status-pill ${escapeHTML(row.status)}">${statusText(row.status)}</span></p>${row.note?`<p>หมายเหตุ: ${escapeHTML(row.note)}</p>`:''}</div><div class="account-actions">${row.status==='pending'?`<button class="btn btn-primary" data-action="booking-approve" data-id="${row.id}">อนุมัติ</button><button class="btn btn-danger" data-action="booking-reject" data-id="${row.id}">ปฏิเสธ</button>`:''}</div></div>`}).join('')}</div>`;
    return;
  }
  out.innerHTML='<div class="account-empty">ไม่พบหน้าจัดการที่ต้องการ</div>';
}
async function renderAccountTab(tab) {
  if (!liveMode || !currentSession?.user || !$('#accountContent')) return;
  accountTab = tab;
  $$('.account-tab[data-action="account-tab"]').forEach(btn => { const active=btn.dataset.tab===tab; btn.classList.toggle('active',active); btn.setAttribute('aria-pressed',String(active)); });
  const out = $('#accountContent'); out.innerHTML='<div class="account-empty">กำลังโหลดข้อมูล…</div>';
  const uid = currentSession.user.id;
  try {
    if (tab.startsWith('admin-')) { await renderAdminTab(tab, out); return; }
    if (tab === 'inbox') { await refreshConversationList(); return; }
    if (tab === 'my-wanted') {
      const { data:requests, error } = await supabase.from('wanted_requests')
        .select('id,title,category,budget_per_day,requested_date,duration,pickup_zone,status,created_at')
        .eq('owner_id', uid).order('created_at', { ascending:false });
      if (error) throw error;
      if (!requests?.length) { out.innerHTML='<div class="account-empty">คุณยังไม่ได้เผยแพร่ความต้องการ</div>'; return; }
      const ids = requests.map(request => request.id);
      const { data:offers, error:offerError } = await supabase.from('wanted_offers')
        .select('wanted_request_id,status').in('wanted_request_id', ids);
      if (offerError) throw offerError;
      const offerCounts = {};
      for (const offer of offers || []) offerCounts[offer.wanted_request_id] = (offerCounts[offer.wanted_request_id] || 0) + 1;
      out.innerHTML = `<div class="account-list">${requests.map(request => `<div class="account-row"><div><h3>${escapeHTML(request.title)}</h3><p>${escapeHTML(categoryLabels[request.category] || 'อื่น ๆ')} · งบ ฿${formatBaht(request.budget_per_day)}/วัน · ${formatDateThai(request.requested_date)} · ${escapeHTML(request.duration)}</p><p>โซนรับ: ${escapeHTML(request.pickup_zone)} · ${offerCounts[request.id] || 0} ข้อเสนอ · <span class="status-pill ${request.status==='open'?'approved':'cancelled'}">${request.status==='open'?'เปิดรับข้อเสนอ':'ปิดรับแล้ว'}</span></p></div><div class="account-actions">${request.status==='open'?`<button class="btn btn-secondary" data-action="close-wanted" data-id="${escapeHTML(request.id)}">ปิดรับข้อเสนอ</button>`:''}</div></div>`).join('')}</div>`;
      return;
    }
    if (tab === 'incoming-offers') {
      const { data:requests, error:requestError } = await supabase.from('wanted_requests')
        .select('id,title').eq('owner_id', uid);
      if (requestError) throw requestError;
      if (!requests?.length) { out.innerHTML='<div class="account-empty">เมื่อคุณเผยแพร่ความต้องการ ข้อเสนอจากสมาชิกจะแสดงที่นี่</div>'; return; }
      const requestById = Object.fromEntries(requests.map(request => [request.id, request]));
      const { data:offers, error:offerError } = await supabase.from('wanted_offers')
        .select('id,wanted_request_id,offerer_id,listing_id,message,status,created_at,profiles!wanted_offers_offerer_id_fkey(full_name)')
        .in('wanted_request_id', requests.map(request => request.id))
        .order('created_at', { ascending:false });
      if (offerError) throw offerError;
      if (!offers?.length) { out.innerHTML='<div class="account-empty">ยังไม่มีข้อเสนอสำหรับความต้องการของคุณ</div>'; return; }
      const listingIds = [...new Set(offers.map(offer => offer.listing_id).filter(Boolean))];
      const { data:listings, error:listingError } = listingIds.length
        ? await supabase.from('listings').select('id,title,owner_id').in('id', listingIds)
        : { data:[], error:null };
      if (listingError) throw listingError;
      const listingById = Object.fromEntries((listings || []).map(listing => [listing.id, listing]));
      out.innerHTML = `<div class="account-list">${offers.map(offer => {
        const listing = listingById[offer.listing_id];
        return `<div class="account-row"><div><h3>${escapeHTML(requestById[offer.wanted_request_id]?.title || 'ความต้องการ')}</h3><p>ข้อเสนอจาก ${escapeHTML(offer.profiles?.full_name || 'สมาชิก')}${listing?` · <button class="text-action" data-action="open-listing-detail" data-id="${escapeHTML(listing.id)}">${escapeHTML(listing.title)}</button>`:' · ไม่มีประกาศสินค้าแนบ'}</p><p>${escapeHTML(offer.message)}</p><p>${formatTime(offer.created_at)} · <span class="status-pill ${escapeHTML(offer.status)}">${offer.status==='pending'?'รอตอบรับ':offer.status==='accepted'?'ตอบรับแล้ว':'ปฏิเสธแล้ว'}</span></p></div><div class="account-actions">${offer.status==='pending'?`<button class="btn btn-primary" data-action="offer-accept" data-id="${escapeHTML(offer.id)}">ตอบรับข้อเสนอ</button><button class="btn btn-danger" data-action="offer-decline" data-id="${escapeHTML(offer.id)}">ปฏิเสธ</button>`:''}${listing?`<button class="btn btn-secondary" data-action="offer-chat" data-listing-id="${escapeHTML(listing.id)}">แชตกับผู้เสนอ</button>`:'<span class="hint">แนบประกาศเพื่อเริ่มแชต</span>'}</div></div>`;
      }).join('')}</div>`;
      return;
    }
    if (tab === 'my-listings') {
      const {data,error}=await supabase.from('listings').select('*').eq('owner_id',uid).order('created_at',{ascending:false});
      if(error) throw error;
      if(!data?.length){out.innerHTML='<div class="account-empty">คุณยังไม่มีประกาศ กดปุ่ม “ลงประกาศปล่อยเช่า” เพื่อเพิ่มรายการแรก</div>';return;}
      out.innerHTML=`<div class="account-list">${data.map(row=>`<div class="account-row"><div><h3>${escapeHTML(row.title)}</h3><p>฿${formatBaht(row.price_per_day)} / วัน · ${escapeHTML(row.location||'ยังไม่ได้ระบุตำแหน่ง')}</p><p><span class="status-pill ${row.is_available?'approved':'cancelled'}">${row.is_available?'เปิดให้เช่า':'ซ่อนประกาศ'}</span> · เพิ่มเมื่อ ${formatDateThai(String(row.created_at||'').slice(0,10))}</p></div><div class="account-actions"><button class="btn btn-secondary" data-action="edit-listing" data-id="${row.id}">แก้ไข</button><button class="btn btn-secondary" data-action="toggle-listing" data-id="${row.id}" data-available="${row.is_available}">${row.is_available?'ซ่อนประกาศ':'เปิดให้เช่า'}</button><button class="btn btn-danger" data-action="delete-listing" data-id="${row.id}">ลบ</button></div></div>`).join('')}</div>`; return;
    }
    if (tab === 'as-renter') {
      const {data,error}=await supabase.from('bookings').select('*').eq('renter_id',uid).order('created_at',{ascending:false});
      if(error) throw error;
      const rows=data||[]; const itemIds=[...new Set(rows.map(x=>x.listing_id))];
      const listingsMap={};
      if(itemIds.length){const r=await supabase.from('listings').select('id,title,price_per_day,location,owner_id').in('id',itemIds); if(!r.error) for(const it of r.data||[])listingsMap[it.id]=it;}
      if(!rows.length){out.innerHTML='<div class="account-empty">คุณยังไม่ได้ส่งคำขอจองสินค้า</div>';return;}
      out.innerHTML=`<div class="account-list">${rows.map(row=>{const item=listingsMap[row.listing_id]||{};return `<div class="account-row"><div><h3>${escapeHTML(item.title||'ประกาศสินค้า')}</h3><p>${formatDateThai(row.start_date)} – ${formatDateThai(row.end_date)} · ${escapeHTML(row.pickup_location||'-')}</p><p>ค่าเช่ารวม ฿${formatBaht(row.total_price)} · <span class="status-pill ${escapeHTML(row.status)}">${statusText(row.status)}</span></p>${row.note?`<p>ข้อความ: ${escapeHTML(row.note)}</p>`:''}</div><div class="account-actions">${item.id?`<button class="btn btn-secondary" data-action="booking-chat" data-id="${escapeHTML(row.id)}">แชตเกี่ยวกับการจอง</button>`:''}${row.status==='pending'?`<button class="btn btn-danger" data-action="cancel-booking" data-id="${row.id}">ยกเลิกคำขอ</button>`:''}</div></div>`}).join('')}</div>`; return;
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
    out.innerHTML=`<div class="account-list">${rows.map(row=>{const item=listingById[row.listing_id]||{};return `<div class="account-row"><div><h3>${escapeHTML(item.title||'ประกาศสินค้า')}</h3><p>ผู้จอง: ${escapeHTML(names[row.renter_id]||'สมาชิก')} · ${formatDateThai(row.start_date)} – ${formatDateThai(row.end_date)}</p><p>จุดนัดรับ: ${escapeHTML(row.pickup_location||'-')} · ค่าเช่ารวม ฿${formatBaht(row.total_price)}</p>${row.note?`<p>ข้อความ: ${escapeHTML(row.note)}</p>`:''}<p><span class="status-pill ${escapeHTML(row.status)}">${statusText(row.status)}</span></p></div><div class="account-actions">${item.id?`<button class="btn btn-secondary" data-action="booking-chat" data-id="${escapeHTML(row.id)}">แชตเกี่ยวกับการจอง</button>`:''}${row.status==='pending'?`<button class="btn btn-primary" data-action="booking-approve" data-id="${row.id}">อนุมัติ</button><button class="btn btn-danger" data-action="booking-reject" data-id="${row.id}">ปฏิเสธ</button>`:''}</div></div>`}).join('')}</div>`;
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
async function respondToOffer(id, status) {
  const { error } = await supabase.rpc('respond_to_wanted_offer', { p_offer_id:id, p_status:status });
  if (error) return showToast('เปลี่ยนสถานะข้อเสนอไม่สำเร็จ: ' + friendlyError(error));
  showToast(status === 'accepted' ? 'ตอบรับข้อเสนอแล้ว และปิดรับข้อเสนอเพิ่มเติม' : 'ปฏิเสธข้อเสนอแล้ว');
  await renderAccountTab('incoming-offers');
  await refreshWantedRequests();
}
async function closeWantedRequest(id) {
  const { data, error } = await supabase.from('wanted_requests')
    .update({ status:'closed' }).eq('id', id).eq('owner_id', currentSession.user.id)
    .eq('status', 'open').select('id').maybeSingle();
  if (error) return showToast('ปิดรับข้อเสนอไม่สำเร็จ: ' + friendlyError(error));
  if (!data) return showToast('ไม่พบคำขอหรือคำขอนี้ปิดไปแล้ว');
  showToast('ปิดรับข้อเสนอแล้ว');
  await renderAccountTab('my-wanted');
  await refreshWantedRequests();
}
async function logout() {
  const {error}=await supabase.auth.signOut();
  if(error) return showToast('ออกจากระบบไม่สำเร็จ: '+friendlyError(error));
  applyAuthSession(null); closeModal(); showToast('ออกจากระบบแล้ว');
}
async function manageListing(id,action,currentAvailable) {
  if(!currentSession?.user) return openAuthModal('login');
  let result;
  if(action==='delete') {
    if(!confirm('ต้องการลบประกาศนี้ใช่ไหม? การลบจะไม่สามารถย้อนกลับได้')) return;
    const check=await supabase.from('bookings').select('id',{count:'exact',head:true}).eq('listing_id',id);
    if(check.error) return showToast('ตรวจสอบประวัติการจองไม่สำเร็จ: '+friendlyError(check.error));
    if((check.count||0)>0) return showToast('รายการนี้มีประวัติการจอง จึงลบไม่ได้เพื่อเก็บประวัติไว้ คุณสามารถซ่อนประกาศแทนได้');
    const imageResult=await supabase.from('listings').select('image_path').eq('id',id).maybeSingle();
    let query=supabase.from('listings').delete().eq('id',id);
    if(!currentIsAdmin) query=query.eq('owner_id',currentSession.user.id);
    result=await query;
    if(!result.error && imageResult.data?.image_path) {
      const removed=await supabase.storage.from(LISTING_IMAGE_BUCKET).remove([imageResult.data.image_path]);
      if(removed.error) console.warn('ลบไฟล์รูปไม่สำเร็จ',removed.error);
    }
  } else {
    let query=supabase.from('listings').update({is_available:!currentAvailable}).eq('id',id);
    if(!currentIsAdmin) query=query.eq('owner_id',currentSession.user.id);
    result=await query;
  }
  if(result.error) return showToast('จัดการประกาศไม่สำเร็จ: '+friendlyError(result.error));
  await refreshListings(); await renderAccountTab(currentIsAdmin && accountTab.startsWith('admin-') ? accountTab : 'my-listings'); showToast(action==='delete'?'ลบประกาศแล้ว':currentAvailable?'ซ่อนประกาศแล้ว':'เปิดประกาศให้เช่าแล้ว');
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
  else if(action==='open-listing-detail') listingDetail(id);
  else if(action==='listing-chat') await openConversationForListing(id);
  else if(action==='booking-chat') await openConversationForBooking(id);
  else if(action==='offer-chat') await openConversationForListing(actionEl.dataset.listingId);
  else if(action==='open-conversation') await openConversation(id);
  else if(action==='open-inbox') await openInbox();
  else if(action==='open-notifications') await openNotifications();
  else if(action==='notification-link') await openNotificationTarget(id);
  else if(action==='mark-notifications-read') await markNotificationsRead();
  else if(action==='load-more-notifications') await loadMoreNotifications();
  else if(action==='offer-request') await openOfferForm(id);
  else if(action==='offer-accept') await respondToOffer(id,'accepted');
  else if(action==='offer-decline') await respondToOffer(id,'declined');
  else if(action==='close-wanted') await closeWantedRequest(id);
  else if(action==='edit-listing') openListingForm(id);
  else if(action==='map-view') setListingsView(true);
  else if(action==='list-view') setListingsView(false);
  else if(action==='favorite'){event.stopPropagation();toggleFavorite(id);}
  else if(action==='book') openBooking(id);
  else if(action==='request') openRequestForm();
  else if(action==='close') closeModal();
  else if(action==='back-detail') listingDetail(id);
  else if(action==='open-listing') openListingForm();
  else if(action==='auth-mode-login') openAuthModal('login');
  else if(action==='auth-mode-signup') openAuthModal('signup');
  else if(action==='open-account') openAccountDashboard();
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
  if(event.target.id==='offerForm'){event.preventDefault();handleOfferSubmit(event.target);}
  if(event.target.id==='messageForm'){event.preventDefault();sendMessage(event.target);}
});
$('#filterRow').addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;activeCategory=btn.dataset.category;renderListings();});
$('#categoryGrid').addEventListener('click',e=>{const btn=e.target.closest('[data-category]');if(!btn)return;activeCategory=btn.dataset.category;$('#categorySelect').value=activeCategory;renderListings();$('#explore').scrollIntoView({behavior:'smooth'});});
$('#sortSelect').addEventListener('change',e=>{sortMode=e.target.value;renderListings();});
$('#listViewButton').addEventListener('click',()=>setListingsView(false));
$('#mapViewButton').addEventListener('click',()=>setListingsView(true));
$('#closeModal').addEventListener('click',closeModal);
$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
['#openRequestTop','#openRequestHero','#openRequestMain','#openRequestMobile'].forEach(sel=>$(sel)?.addEventListener('click',openRequestForm));
['#openListingTop','#openListingMobile'].forEach(sel=>$(sel)?.addEventListener('click',()=>openListingForm()));
$('#openAuthTop')?.addEventListener('click',()=>openAuthModal('login'));
$('#openAccountTop')?.addEventListener('click',()=>openAccountDashboard());
$('#openInboxTop')?.addEventListener('click',openInbox);
$('#openNotificationsTop')?.addEventListener('click',openNotifications);
$('#mobileMenu').addEventListener('click',()=>{
  const accountActions = currentSession?.user
    ? `<button class="btn btn-secondary" data-action="open-account">${currentIsAdmin?'แผงควบคุมแอดมิน':'บัญชีของฉัน'}</button><button class="btn btn-secondary" data-action="open-inbox">ข้อความ</button><button class="btn btn-secondary" data-action="open-notifications">การแจ้งเตือน <span class="notification-count" data-mobile-notification-count>0</span></button><button class="btn btn-danger" data-action="logout">ออกจากระบบ</button>`
    : `<button class="btn btn-secondary" data-action="auth-mode-login">เข้าสู่ระบบ / สมัครสมาชิก</button>`;
  openModal('เมนู','เลือกส่วนที่ต้องการไป',`<div style="display:grid;gap:10px">${accountActions}<button class="btn btn-secondary" data-action="open-listing">ลงประกาศ</button><a class="btn btn-secondary" href="#explore" data-action="close">ค้นหาของ</a><a class="btn btn-secondary" href="#demand" data-action="close">แจ้งสิ่งที่ต้องการ</a><a class="btn btn-secondary" href="#how" data-action="close">วิธีใช้งาน</a><button class="btn btn-primary" data-action="close">ปิดเมนู</button></div>`);
});
$('#mobileMenu').addEventListener('click',()=>{
  const badge = $('#modalContent [data-mobile-notification-count]');
  if (badge) {
    const count = Number($('#notificationCount')?.dataset.unread || 0);
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
});

async function initialize() {
  setConnectionNotice();
  if (!liveMode) {
    getListings(); renderListings(); updateAuthButtons(); await refreshWantedRequests(); return;
  }
  if (!authSubscription) {
    const result = supabase.auth.onAuthStateChange((_event, session) => {
      applyAuthSession(session);
    });
    authSubscription = result.data.subscription;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('อ่าน session ไม่สำเร็จ', error);
    showToast('กู้คืนสถานะเข้าสู่ระบบไม่สำเร็จ: ' + friendlyError(error));
  }
  applyAuthSession(data?.session || null);
  await refreshListings();
  await refreshWantedRequests();
}

function applyAuthSession(session) {
  const previousUserId = currentSession?.user?.id || null;
  const nextUserId = session?.user?.id || null;
  currentSession = session || null;
  const generation = ++authGeneration;
  if (previousUserId !== nextUserId) {
    currentProfile = null;
    currentIsAdmin = false;
  }
  updateAuthButtons();
  if (!nextUserId) {
    currentProfile = null;
    currentIsAdmin = false;
    notificationCache = [];
    stopRealtime();
    updateAuthButtons();
    if ($('#modalBackdrop')?.classList.contains('open')) closeModal();
    return;
  }
  setTimeout(async () => {
    if (generation !== authGeneration || currentSession?.user?.id !== nextUserId) return;
    await loadCurrentProfile(nextUserId);
    if (generation !== authGeneration || currentSession?.user?.id !== nextUserId) return;
    startRealtime(nextUserId);
    await importLegacyWantedRequests(nextUserId);
    if (generation !== authGeneration || currentSession?.user?.id !== nextUserId) return;
    await Promise.all([refreshListings(), refreshWantedRequests()]);
  }, 0);
}
initialize();
