/**
 * Lightweight locale-aware message lookup for the API.
 *
 * Clients send their UI language in the `Accept-Language` header (primary
 * tag). The server renders the `message` field of an error response in
 * the user's language; if no translation exists, we fall back to English,
 * then to the caller-provided default.
 *
 * Scope: the three generic error codes emitted by error-handler.ts
 * (VALIDATION_ERROR, REQUEST_ERROR, INTERNAL_SERVER_ERROR) plus the
 * common route-level codes catalogued here. Unknown codes pass through
 * with their original message intact — coverage stays additive.
 */

type LocaleMap = Record<string, string>

// 18 locales the client supports; parse + match via pickLocale().
const SUPPORTED = new Set([
  'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'th', 'es', 'it', 'fr', 'de',
  'pt', 'hi', 'ar', 'tr', 'el', 'ru', 'ms', 'id', 'fil',
])

// Translations are embedded (not a JSON file) so we don't fight esbuild
// or tsc resolveJsonModule config on the api side.
const MESSAGES: Record<string, LocaleMap> = {
  // ── Generic (error-handler) ───────────────────────────────────────────
  VALIDATION_ERROR: {
    en:'Invalid request.', 'zh-CN':'请求无效。', 'zh-TW':'請求無效。', ja:'リクエストが無効です。', ko:'잘못된 요청입니다.',
    th:'คำขอไม่ถูกต้อง', es:'Solicitud no válida.', it:'Richiesta non valida.', fr:'Requête non valide.', de:'Ungültige Anfrage.',
    pt:'Solicitação inválida.', hi:'अमान्य अनुरोध।', ar:'طلب غير صالح.', tr:'Geçersiz istek.', el:'Μη έγκυρο αίτημα.',
    ru:'Недопустимый запрос.', ms:'Permintaan tidak sah.', id:'Permintaan tidak valid.', fil:'Di-wastong kahilingan.',
  },
  INTERNAL_SERVER_ERROR: {
    en:'An unexpected error occurred', 'zh-CN':'发生意外错误', 'zh-TW':'發生意外錯誤', ja:'予期しないエラーが発生しました', ko:'예기치 않은 오류가 발생했습니다',
    th:'เกิดข้อผิดพลาดที่ไม่คาดคิด', es:'Se produjo un error inesperado', it:'Si è verificato un errore imprevisto', fr:'Une erreur inattendue est survenue', de:'Ein unerwarteter Fehler ist aufgetreten',
    pt:'Ocorreu um erro inesperado', hi:'एक अप्रत्याशित त्रुटि हुई', ar:'حدث خطأ غير متوقع', tr:'Beklenmeyen bir hata oluştu', el:'Προέκυψε μη αναμενόμενο σφάλμα',
    ru:'Произошла непредвиденная ошибка', ms:'Ralat tidak dijangka berlaku', id:'Terjadi kesalahan tak terduga', fil:'May di-inaasahang error na naganap',
  },
  // ── Not found / registry ─────────────────────────────────────────────
  NAME_NOT_FOUND: {
    en:'Name not found', 'zh-CN':'未找到该名称', 'zh-TW':'未找到該名稱', ja:'名前が見つかりません', ko:'이름을 찾을 수 없습니다',
    th:'ไม่พบชื่อ', es:'Nombre no encontrado', it:'Nome non trovato', fr:'Nom introuvable', de:'Name nicht gefunden',
    pt:'Nome não encontrado', hi:'नाम नहीं मिला', ar:'الاسم غير موجود', tr:'İsim bulunamadı', el:'Το όνομα δεν βρέθηκε',
    ru:'Имя не найдено', ms:'Nama tidak dijumpai', id:'Nama tidak ditemukan', fil:'Hindi nahanap ang pangalan',
  },
  RECIPIENT_NOT_FOUND: {
    en:'Recipient not found', 'zh-CN':'未找到收款人', 'zh-TW':'未找到收款人', ja:'受取人が見つかりません', ko:'수취인을 찾을 수 없습니다',
    th:'ไม่พบผู้รับ', es:'Destinatario no encontrado', it:'Destinatario non trovato', fr:'Destinataire introuvable', de:'Empfänger nicht gefunden',
    pt:'Destinatário não encontrado', hi:'प्राप्तकर्ता नहीं मिला', ar:'لم يتم العثور على المستلم', tr:'Alıcı bulunamadı', el:'Ο παραλήπτης δεν βρέθηκε',
    ru:'Получатель не найден', ms:'Penerima tidak dijumpai', id:'Penerima tidak ditemukan', fil:'Hindi nahanap ang tatanggap',
  },
  NOT_FOUND: {
    en:'Not found', 'zh-CN':'未找到', 'zh-TW':'未找到', ja:'見つかりません', ko:'찾을 수 없습니다',
    th:'ไม่พบ', es:'No encontrado', it:'Non trovato', fr:'Introuvable', de:'Nicht gefunden',
    pt:'Não encontrado', hi:'नहीं मिला', ar:'غير موجود', tr:'Bulunamadı', el:'Δεν βρέθηκε',
    ru:'Не найдено', ms:'Tidak dijumpai', id:'Tidak ditemukan', fil:'Hindi nahanap',
  },
  TX_NOT_FOUND: {
    en:'Transaction not found', 'zh-CN':'未找到交易', 'zh-TW':'未找到交易', ja:'取引が見つかりません', ko:'거래를 찾을 수 없습니다',
    th:'ไม่พบธุรกรรม', es:'Transacción no encontrada', it:'Transazione non trovata', fr:'Transaction introuvable', de:'Transaktion nicht gefunden',
    pt:'Transação não encontrada', hi:'लेन-देन नहीं मिला', ar:'المعاملة غير موجودة', tr:'İşlem bulunamadı', el:'Η συναλλαγή δεν βρέθηκε',
    ru:'Транзакция не найдена', ms:'Transaksi tidak dijumpai', id:'Transaksi tidak ditemukan', fil:'Hindi nahanap ang transaksyon',
  },
  // ── Auth / authorization ─────────────────────────────────────────────
  UNAUTHORIZED: {
    en:'Unauthorized', 'zh-CN':'未授权', 'zh-TW':'未授權', ja:'認証されていません', ko:'권한이 없습니다',
    th:'ไม่ได้รับอนุญาต', es:'No autorizado', it:'Non autorizzato', fr:'Non autorisé', de:'Nicht autorisiert',
    pt:'Não autorizado', hi:'अनधिकृत', ar:'غير مصرح', tr:'Yetkisiz', el:'Μη εξουσιοδοτημένο',
    ru:'Не авторизован', ms:'Tidak dibenarkan', id:'Tidak diizinkan', fil:'Walang pahintulot',
  },
  FORBIDDEN: {
    en:'Forbidden', 'zh-CN':'禁止访问', 'zh-TW':'禁止存取', ja:'アクセス禁止', ko:'금지됨',
    th:'ต้องห้าม', es:'Prohibido', it:'Vietato', fr:'Interdit', de:'Verboten',
    pt:'Proibido', hi:'निषिद्ध', ar:'محظور', tr:'Yasak', el:'Απαγορεύεται',
    ru:'Запрещено', ms:'Dilarang', id:'Dilarang', fil:'Ipinagbabawal',
  },
  NOT_ADMIN: {
    en:'Admin privileges required', 'zh-CN':'需要管理员权限', 'zh-TW':'需要管理員權限', ja:'管理者権限が必要です', ko:'관리자 권한이 필요합니다',
    th:'ต้องการสิทธิ์ผู้ดูแล', es:'Se requieren privilegios de administrador', it:'Richiesti privilegi di amministratore', fr:'Droits administrateur requis', de:'Administratorrechte erforderlich',
    pt:'Requer privilégios de administrador', hi:'व्यवस्थापक अधिकार आवश्यक', ar:'مطلوب صلاحيات المسؤول', tr:'Yönetici yetkisi gerekli', el:'Απαιτούνται δικαιώματα διαχειριστή',
    ru:'Требуются права администратора', ms:'Keistimewaan pentadbir diperlukan', id:'Memerlukan hak admin', fil:'Kailangan ng admin privileges',
  },
  SESSION_EXPIRED: {
    en:'Session expired', 'zh-CN':'会话已过期', 'zh-TW':'工作階段已過期', ja:'セッションの有効期限切れ', ko:'세션이 만료되었습니다',
    th:'เซสชันหมดอายุ', es:'Sesión expirada', it:'Sessione scaduta', fr:'Session expirée', de:'Sitzung abgelaufen',
    pt:'Sessão expirada', hi:'सत्र समाप्त', ar:'انتهت الجلسة', tr:'Oturum süresi doldu', el:'Η συνεδρία έληξε',
    ru:'Сессия истекла', ms:'Sesi tamat', id:'Sesi berakhir', fil:'Nag-expire ang session',
  },
  NONCE_EXPIRED: {
    en:'Nonce expired', 'zh-CN':'随机数已过期', 'zh-TW':'Nonce 已過期', ja:'Nonce の有効期限切れ', ko:'Nonce가 만료되었습니다',
    th:'Nonce หมดอายุ', es:'Nonce expirado', it:'Nonce scaduto', fr:'Nonce expiré', de:'Nonce abgelaufen',
    pt:'Nonce expirado', hi:'Nonce समाप्त', ar:'انتهى nonce', tr:'Nonce süresi doldu', el:'Το nonce έληξε',
    ru:'Срок действия nonce истёк', ms:'Nonce tamat', id:'Nonce berakhir', fil:'Nag-expire ang nonce',
  },
  CHALLENGE_EXPIRED: {
    en:'Challenge expired', 'zh-CN':'挑战已过期', 'zh-TW':'驗證已過期', ja:'チャレンジの有効期限切れ', ko:'챌린지가 만료되었습니다',
    th:'คำท้าหมดอายุ', es:'Desafío expirado', it:'Sfida scaduta', fr:'Défi expiré', de:'Challenge abgelaufen',
    pt:'Desafio expirado', hi:'चुनौती समाप्त', ar:'انتهى التحدي', tr:'Doğrulama süresi doldu', el:'Η πρόκληση έληξε',
    ru:'Срок проверки истёк', ms:'Cabaran tamat', id:'Challenge berakhir', fil:'Nag-expire ang challenge',
  },
  NO_PENDING_CHALLENGE: {
    en:'No pending challenge', 'zh-CN':'没有待处理的挑战', 'zh-TW':'沒有待處理的驗證', ja:'保留中のチャレンジはありません', ko:'대기 중인 챌린지가 없습니다',
    th:'ไม่มีคำท้าที่รอดำเนินการ', es:'Sin desafío pendiente', it:'Nessuna sfida in sospeso', fr:'Aucun défi en attente', de:'Keine ausstehende Challenge',
    pt:'Sem desafio pendente', hi:'कोई लंबित चुनौती नहीं', ar:'لا يوجد تحدٍّ معلّق', tr:'Bekleyen doğrulama yok', el:'Καμία εκκρεμής πρόκληση',
    ru:'Нет ожидающих проверок', ms:'Tiada cabaran menunggu', id:'Tidak ada challenge tertunda', fil:'Walang hinihintay na challenge',
  },
  TOS_REQUIRED: {
    en:'You must accept the Terms of Service first', 'zh-CN':'请先接受服务条款', 'zh-TW':'請先接受服務條款', ja:'先に利用規約に同意してください', ko:'먼저 서비스 약관에 동의해 주세요',
    th:'กรุณายอมรับข้อกำหนดการให้บริการก่อน', es:'Debes aceptar los Términos del Servicio primero', it:'Devi prima accettare i Termini di Servizio', fr:'Vous devez d\'abord accepter les conditions', de:'Du musst zuerst die AGB akzeptieren',
    pt:'Você precisa aceitar os Termos primeiro', hi:'पहले सेवा शर्तें स्वीकार करें', ar:'يجب قبول شروط الخدمة أولاً', tr:'Önce Hizmet Şartları\'nı kabul etmelisin', el:'Πρέπει πρώτα να δεχτείς τους όρους',
    ru:'Сначала примите Условия обслуживания', ms:'Anda mesti menerima Syarat Perkhidmatan dahulu', id:'Anda harus menerima Syarat Layanan dulu', fil:'Dapat mong tanggapin muna ang Terms of Service',
  },
  NOT_REGISTERED: {
    en:'Not registered', 'zh-CN':'未注册', 'zh-TW':'未註冊', ja:'未登録', ko:'등록되지 않음',
    th:'ยังไม่ได้ลงทะเบียน', es:'No registrado', it:'Non registrato', fr:'Non enregistré', de:'Nicht registriert',
    pt:'Não registrado', hi:'पंजीकृत नहीं', ar:'غير مسجل', tr:'Kayıtlı değil', el:'Δεν έχει εγγραφεί',
    ru:'Не зарегистрирован', ms:'Tidak berdaftar', id:'Belum terdaftar', fil:'Hindi pa naka-register',
  },
  // ── Invalid / missing input ──────────────────────────────────────────
  INVALID_ADDRESS: {
    en:'Invalid address', 'zh-CN':'地址无效', 'zh-TW':'地址無效', ja:'無効なアドレス', ko:'잘못된 주소',
    th:'ที่อยู่ไม่ถูกต้อง', es:'Dirección no válida', it:'Indirizzo non valido', fr:'Adresse invalide', de:'Ungültige Adresse',
    pt:'Endereço inválido', hi:'अमान्य पता', ar:'عنوان غير صالح', tr:'Geçersiz adres', el:'Μη έγκυρη διεύθυνση',
    ru:'Неверный адрес', ms:'Alamat tidak sah', id:'Alamat tidak valid', fil:'Di-wastong address',
  },
  INVALID_TOKEN: {
    en:'Invalid token', 'zh-CN':'令牌无效', 'zh-TW':'權杖無效', ja:'無効なトークン', ko:'잘못된 토큰',
    th:'โทเค็นไม่ถูกต้อง', es:'Token no válido', it:'Token non valido', fr:'Jeton invalide', de:'Ungültiges Token',
    pt:'Token inválido', hi:'अमान्य टोकन', ar:'رمز غير صالح', tr:'Geçersiz belirteç', el:'Μη έγκυρο διακριτικό',
    ru:'Неверный токен', ms:'Token tidak sah', id:'Token tidak valid', fil:'Di-wastong token',
  },
  INVALID_NICKNAME: {
    en:'Invalid nickname', 'zh-CN':'昵称无效', 'zh-TW':'暱稱無效', ja:'無効なニックネーム', ko:'잘못된 닉네임',
    th:'ชื่อเล่นไม่ถูกต้อง', es:'Apodo no válido', it:'Nickname non valido', fr:'Pseudo invalide', de:'Ungültiger Spitzname',
    pt:'Apelido inválido', hi:'अमान्य उपनाम', ar:'اسم مستعار غير صالح', tr:'Geçersiz rumuz', el:'Μη έγκυρο ψευδώνυμο',
    ru:'Неверный ник', ms:'Nama panggilan tidak sah', id:'Julukan tidak valid', fil:'Di-wastong palayaw',
  },
  INVALID_RECIPIENT: {
    en:'Invalid recipient', 'zh-CN':'收款人无效', 'zh-TW':'收款人無效', ja:'無効な受取人', ko:'잘못된 수취인',
    th:'ผู้รับไม่ถูกต้อง', es:'Destinatario no válido', it:'Destinatario non valido', fr:'Destinataire invalide', de:'Ungültiger Empfänger',
    pt:'Destinatário inválido', hi:'अमान्य प्राप्तकर्ता', ar:'المستلم غير صالح', tr:'Geçersiz alıcı', el:'Μη έγκυρος παραλήπτης',
    ru:'Неверный получатель', ms:'Penerima tidak sah', id:'Penerima tidak valid', fil:'Di-wastong tatanggap',
  },
  INVALID_IDENTIFIER: {
    en:'Invalid identifier', 'zh-CN':'标识符无效', 'zh-TW':'識別碼無效', ja:'無効な識別子', ko:'잘못된 식별자',
    th:'ตัวระบุไม่ถูกต้อง', es:'Identificador no válido', it:'Identificatore non valido', fr:'Identifiant invalide', de:'Ungültige Kennung',
    pt:'Identificador inválido', hi:'अमान्य पहचानकर्ता', ar:'معرف غير صالح', tr:'Geçersiz tanımlayıcı', el:'Μη έγκυρο αναγνωριστικό',
    ru:'Неверный идентификатор', ms:'Pengenal tidak sah', id:'Pengenal tidak valid', fil:'Di-wastong identifier',
  },
  INVALID_SIGNATURE: {
    en:'Invalid signature', 'zh-CN':'签名无效', 'zh-TW':'簽名無效', ja:'無効な署名', ko:'잘못된 서명',
    th:'ลายเซ็นไม่ถูกต้อง', es:'Firma no válida', it:'Firma non valida', fr:'Signature invalide', de:'Ungültige Signatur',
    pt:'Assinatura inválida', hi:'अमान्य हस्ताक्षर', ar:'توقيع غير صالح', tr:'Geçersiz imza', el:'Μη έγκυρη υπογραφή',
    ru:'Неверная подпись', ms:'Tandatangan tidak sah', id:'Tanda tangan tidak valid', fil:'Di-wastong pirma',
  },
  INVALID_QUERY: {
    en:'Invalid query', 'zh-CN':'查询无效', 'zh-TW':'查詢無效', ja:'無効なクエリ', ko:'잘못된 쿼리',
    th:'คำค้นไม่ถูกต้อง', es:'Consulta no válida', it:'Query non valida', fr:'Requête invalide', de:'Ungültige Abfrage',
    pt:'Consulta inválida', hi:'अमान्य क्वेरी', ar:'استعلام غير صالح', tr:'Geçersiz sorgu', el:'Μη έγκυρο ερώτημα',
    ru:'Неверный запрос', ms:'Pertanyaan tidak sah', id:'Kueri tidak valid', fil:'Di-wastong query',
  },
  INVALID_NONCE: {
    en:'Invalid nonce', 'zh-CN':'随机数无效', 'zh-TW':'Nonce 無效', ja:'無効な nonce', ko:'잘못된 nonce',
    th:'Nonce ไม่ถูกต้อง', es:'Nonce no válido', it:'Nonce non valido', fr:'Nonce invalide', de:'Ungültiger Nonce',
    pt:'Nonce inválido', hi:'अमान्य nonce', ar:'nonce غير صالح', tr:'Geçersiz nonce', el:'Μη έγκυρο nonce',
    ru:'Неверный nonce', ms:'Nonce tidak sah', id:'Nonce tidak valid', fil:'Di-wastong nonce',
  },
  MISSING_AUTH: {
    en:'Authentication required', 'zh-CN':'需要身份验证', 'zh-TW':'需要驗證', ja:'認証が必要です', ko:'인증이 필요합니다',
    th:'ต้องการการรับรองตัวตน', es:'Autenticación requerida', it:'Autenticazione richiesta', fr:'Authentification requise', de:'Authentifizierung erforderlich',
    pt:'Autenticação necessária', hi:'प्रमाणीकरण आवश्यक', ar:'المصادقة مطلوبة', tr:'Kimlik doğrulama gerekli', el:'Απαιτείται έλεγχος ταυτότητας',
    ru:'Требуется аутентификация', ms:'Pengesahan diperlukan', id:'Butuh autentikasi', fil:'Kailangan ng authentication',
  },
  MISSING_ADDRESS: {
    en:'Address is required', 'zh-CN':'需要提供地址', 'zh-TW':'需要提供地址', ja:'アドレスが必要です', ko:'주소가 필요합니다',
    th:'ต้องระบุที่อยู่', es:'Se requiere dirección', it:'Indirizzo richiesto', fr:'Adresse requise', de:'Adresse erforderlich',
    pt:'Endereço obrigatório', hi:'पता आवश्यक', ar:'العنوان مطلوب', tr:'Adres gerekli', el:'Απαιτείται διεύθυνση',
    ru:'Требуется адрес', ms:'Alamat diperlukan', id:'Alamat diperlukan', fil:'Kailangan ng address',
  },
  MISSING_SIGNATURE: {
    en:'Signature is required', 'zh-CN':'需要签名', 'zh-TW':'需要簽名', ja:'署名が必要です', ko:'서명이 필요합니다',
    th:'ต้องมีลายเซ็น', es:'Se requiere firma', it:'Firma richiesta', fr:'Signature requise', de:'Signatur erforderlich',
    pt:'Assinatura obrigatória', hi:'हस्ताक्षर आवश्यक', ar:'التوقيع مطلوب', tr:'İmza gerekli', el:'Απαιτείται υπογραφή',
    ru:'Требуется подпись', ms:'Tandatangan diperlukan', id:'Tanda tangan diperlukan', fil:'Kailangan ng pirma',
  },
  MISSING_FIELDS: {
    en:'Missing required fields', 'zh-CN':'缺少必填字段', 'zh-TW':'缺少必填欄位', ja:'必須フィールドが不足しています', ko:'필수 필드가 누락되었습니다',
    th:'ฟิลด์ที่จำเป็นขาดหายไป', es:'Faltan campos requeridos', it:'Mancano campi obbligatori', fr:'Champs requis manquants', de:'Pflichtfelder fehlen',
    pt:'Faltam campos obrigatórios', hi:'आवश्यक फ़ील्ड गायब', ar:'الحقول المطلوبة مفقودة', tr:'Gerekli alanlar eksik', el:'Λείπουν υποχρεωτικά πεδία',
    ru:'Отсутствуют обязательные поля', ms:'Medan wajib tiada', id:'Field wajib hilang', fil:'May kulang na mga kinakailangang field',
  },
  // ── Transaction / crypto ─────────────────────────────────────────────
  TX_FAILED: {
    en:'Transaction failed', 'zh-CN':'交易失败', 'zh-TW':'交易失敗', ja:'取引に失敗しました', ko:'거래 실패',
    th:'ธุรกรรมล้มเหลว', es:'Transacción fallida', it:'Transazione fallita', fr:'Échec de la transaction', de:'Transaktion fehlgeschlagen',
    pt:'Transação falhou', hi:'लेन-देन विफल', ar:'فشلت المعاملة', tr:'İşlem başarısız', el:'Η συναλλαγή απέτυχε',
    ru:'Транзакция не удалась', ms:'Transaksi gagal', id:'Transaksi gagal', fil:'Nabigo ang transaksyon',
  },
  SIGNATURE_VERIFICATION_FAILED: {
    en:'Signature verification failed', 'zh-CN':'签名验证失败', 'zh-TW':'簽名驗證失敗', ja:'署名の検証に失敗しました', ko:'서명 검증 실패',
    th:'การตรวจสอบลายเซ็นล้มเหลว', es:'Verificación de firma fallida', it:'Verifica della firma fallita', fr:'Échec de la vérification de signature', de:'Signaturprüfung fehlgeschlagen',
    pt:'Falha na verificação de assinatura', hi:'हस्ताक्षर सत्यापन विफल', ar:'فشل التحقق من التوقيع', tr:'İmza doğrulama başarısız', el:'Η επαλήθευση υπογραφής απέτυχε',
    ru:'Проверка подписи не удалась', ms:'Pengesahan tandatangan gagal', id:'Verifikasi tanda tangan gagal', fil:'Nabigo ang pag-verify ng pirma',
  },
  CHECKSUM_MISMATCH: {
    en:'Checksum mismatch', 'zh-CN':'校验和不匹配', 'zh-TW':'校驗和不符', ja:'チェックサムの不一致', ko:'체크섬 불일치',
    th:'Checksum ไม่ตรงกัน', es:'Suma de verificación no coincide', it:'Checksum non corrispondente', fr:'Somme de contrôle incorrecte', de:'Prüfsummen-Fehler',
    pt:'Checksum não confere', hi:'चेकसम मेल नहीं खाता', ar:'عدم تطابق المجموع الاختباري', tr:'Sağlama toplamı uyuşmuyor', el:'Ασυμφωνία αθροίσματος ελέγχου',
    ru:'Несовпадение контрольной суммы', ms:'Checksum tidak sepadan', id:'Checksum tidak cocok', fil:'Di-tumugma ang checksum',
  },
  DECRYPTION_FAILED: {
    en:'Decryption failed', 'zh-CN':'解密失败', 'zh-TW':'解密失敗', ja:'復号化に失敗しました', ko:'복호화 실패',
    th:'การถอดรหัสล้มเหลว', es:'Descifrado fallido', it:'Decifratura fallita', fr:'Échec du déchiffrement', de:'Entschlüsselung fehlgeschlagen',
    pt:'Falha na descriptografia', hi:'डिक्रिप्शन विफल', ar:'فشل فك التشفير', tr:'Şifre çözme başarısız', el:'Η αποκρυπτογράφηση απέτυχε',
    ru:'Не удалось расшифровать', ms:'Penyahsulitan gagal', id:'Dekripsi gagal', fil:'Nabigo ang pag-decrypt',
  },
}

/**
 * Parse the primary tag out of an Accept-Language header, normalized to
 * the same form our client-side supportedLngs uses (lowercase lang,
 * uppercase region: "zh-CN" not "zh-cn").
 *
 * Examples:
 *   "zh-CN,zh;q=0.9,en;q=0.8"  → "zh-CN"
 *   "pt-br, en"                → "pt-BR"
 *   undefined                  → "en"
 */
export function pickLocale(header: string | undefined): string {
  if (!header) return 'en'
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim()
  if (!first) return 'en'
  // Normalize to BCP47 casing
  const [lang, region] = first.split('-')
  const norm = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
  if (SUPPORTED.has(norm)) return norm
  // Fall back to the language component (e.g. 'zh-HK' → 'zh' is not in SUPPORTED
  // but we don't have 'zh', so just return 'en').
  if (SUPPORTED.has(lang.toLowerCase())) return lang.toLowerCase()
  return 'en'
}

/**
 * Return the translated message for an error code. Falls through to
 * `defaultMsg` (usually the original English error text) when the code
 * isn't in the MESSAGES table — keeps coverage additive without needing
 * every existing route error translated up front.
 */
export function translateMessage(code: string, locale: string, defaultMsg: string): string {
  const bundle = MESSAGES[code]
  if (!bundle) return defaultMsg
  return bundle[locale] ?? bundle['en'] ?? defaultMsg
}

/** True iff we have a translation bundle for `code`. */
export function hasTranslation(code: string): boolean {
  return code in MESSAGES
}
