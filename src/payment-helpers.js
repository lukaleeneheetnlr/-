// Helpers for the service fee and PromptPay QR (EMVCo / Thai QR Payment).
// The database (calculate_service_fee in service_fee_promptpay_payout_migration.sql)
// is the source of truth for the fee; this file only mirrors it for display.
import QRCode from 'qrcode';

export const DEFAULT_FEE_SETTINGS = Object.freeze({ fee_percent: 10, min_fee: 15 });

export function computeServiceFee(rent, settings = DEFAULT_FEE_SETTINGS) {
  const amount = Number(rent);
  const percent = Number(settings?.fee_percent ?? DEFAULT_FEE_SETTINGS.fee_percent);
  const minFee = Number(settings?.min_fee ?? DEFAULT_FEE_SETTINGS.min_fee);
  if (!Number.isFinite(amount) || amount <= 0 || percent <= 0) return 0;
  const fee = Math.round(amount * percent) / 100;
  return Math.max(Math.round(fee * 100) / 100, minFee);
}

// Amount the renter pays for the "rent" line: rent + service fee snapshot (old bookings have no fee).
export function rentDue(booking) {
  return Number(booking?.total_price || 0) + Number(booking?.service_fee || 0);
}

function tlv(id, value) {
  return id + String(value.length).padStart(2, '0') + value;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function normalizePromptPayId(value) {
  return String(value || '').replace(/\D/g, '');
}

export function isValidPromptPayId(value) {
  return /^(\d{10}|\d{13}|\d{15})$/.test(normalizePromptPayId(value));
}

// Builds the PromptPay payload string for a mobile number (10 digits),
// national/tax ID (13 digits) or e-Wallet ID (15 digits), with a fixed amount.
export function promptPayPayload(promptPayId, amount) {
  const id = normalizePromptPayId(promptPayId);
  if (!isValidPromptPayId(id)) throw new Error('PromptPay ID ไม่ถูกต้อง');
  let target;
  if (id.length === 10) target = tlv('01', ('0000000000000' + '66' + id.slice(1)).slice(-13));
  else if (id.length === 13) target = tlv('02', id);
  else target = tlv('03', id);
  const value = Number(amount);
  const hasAmount = Number.isFinite(value) && value > 0;
  const merchant = tlv('00', 'A000000677010111') + target;
  let payload = tlv('00', '01')
    + tlv('01', hasAmount ? '12' : '11')
    + tlv('29', merchant)
    + tlv('58', 'TH')
    + tlv('53', '764')
    + (hasAmount ? tlv('54', value.toFixed(2)) : '');
  payload += '6304';
  return payload + crc16(payload);
}

export async function promptPayQrDataUrl(promptPayId, amount) {
  return QRCode.toDataURL(promptPayPayload(promptPayId, amount), { margin: 1, width: 280, errorCorrectionLevel: 'M' });
}
