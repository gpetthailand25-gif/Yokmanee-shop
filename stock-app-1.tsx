import React, { useState, useEffect, useMemo, useRef } from "react";
import { db, storage } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// เก็บข้อมูลทั้งหมดของร้านไว้ที่เอกสารเดียว: stock/main
const STOCK_DOC = doc(db, "stock", "main");

/* ---------- Design tokens ----------
   Subject: multi-branch clothing store stock room, ledger-style tracking.
   Signature: garment hang-tag — punched hole + perforation + string knot.
   Layout rule: phone gets true stacked cards, tablet/desktop gets a table.
   The two are separate render branches (not one grid squeezed by CSS),
   so nothing overlaps or scrolls sideways on a small screen.
------------------------------------ */
const C = {
  ink: "#23262B",
  paper: "#F5F1E8",
  paperDark: "#EAE3D4",
  brass: "#B8935A",
  brassDark: "#8C6D3F",
  denim: "#3F5568",
  denimDark: "#2C3E4C",
  moss: "#5B6B4F",
  wine: "#7A2E2E",
  line: "#D8CFBA",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Taviraj:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
.tag-font-display{font-family:'Taviraj',serif;}
.tag-font-body{font-family:'IBM Plex Sans Thai','IBM Plex Sans',sans-serif;}
.tag-font-mono{font-family:'IBM Plex Mono',monospace;}
.tag-hole{width:14px;height:14px;border-radius:50%;background:${C.paper};box-shadow:inset 0 1px 3px rgba(0,0,0,.35);}
.tag-perf{border-top:1.5px dashed ${C.line};}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-thumb{background:${C.line};border-radius:4px;}
`;

const DEFAULT_BRANCHES = [
  { id: "siam", name: "สาขาสยาม" },
  { id: "central", name: "สาขาเซ็นทรัลเวิลด์" },
  { id: "mega", name: "สาขาเมกาบางนา" },
];

const DEFAULT_CATS = [
  { name: "เสื้อยืด", prefix: "TS" },
  { name: "เสื้อเชิ้ต", prefix: "SH" },
  { name: "กางเกงยีนส์", prefix: "JN" },
  { name: "เดรส", prefix: "DR" },
  { name: "แจ็คเก็ต", prefix: "JK" },
  { name: "กระโปรง", prefix: "SK" },
  { name: "ฮู้ด/สเวตเตอร์", prefix: "HD" },
];
const SIZE_PRESETS = ["Free Size", "XS", "S", "M", "L", "XL", "XXL"];
const NEW_CAT_VALUE = "__new_category__";

// build the next SKU for a category, e.g. TS-011, based on how many SKUs already use that prefix
function generateSku(categoryName, categories, products) {
  const cat = categories.find((c) => c.name === categoryName);
  const prefix = cat?.prefix || "GEN";
  const usedNumbers = products
    .map((p) => p.sku)
    .filter((s) => s && s.toUpperCase().startsWith(prefix.toUpperCase() + "-"))
    .map((s) => parseInt(s.split("-")[1], 10))
    .filter((n) => !isNaN(n));
  const next = (usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

// suggest a short Latin prefix for a brand-new category name
function suggestPrefix(name, existingCategories) {
  const latin = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  let base = latin.slice(0, 3) || "CAT";
  let candidate = base;
  let i = 1;
  const taken = new Set(existingCategories.map((c) => c.prefix));
  while (taken.has(candidate)) { i += 1; candidate = base + i; }
  return candidate;
}

const seedProducts = () => [
  { id: "p1", name: "เสื้อยืดคอกลม เบสิค", sku: "TS-001", category: "เสื้อยืด", price: 259, image: null, size: "M", chest: "36-38", stock: { siam: 42, central: 18, mega: 30 } },
  { id: "p2", name: "เสื้อเชิ้ตลินินแขนยาว", sku: "SH-001", category: "เสื้อเชิ้ต", price: 590, image: null, size: "L", chest: "40", stock: { siam: 12, central: 4, mega: 9 } },
  { id: "p3", name: "กางเกงยีนส์ทรงกระบอก", sku: "JN-001", category: "กางเกงยีนส์", price: 890, image: null, size: "30", chest: null, stock: { siam: 20, central: 3, mega: 14 } },
  { id: "p4", name: "เดรสลายดอกแขนกุด", sku: "DR-001", category: "เดรส", price: 690, image: null, size: "S", chest: "32-34", stock: { siam: 8, central: 15, mega: 2 } },
  { id: "p5", name: "แจ็คเก็ตยีนส์โอเวอร์ไซส์", sku: "JK-001", category: "แจ็คเก็ต", price: 1290, image: null, size: "Free Size", chest: "40-44", stock: { siam: 6, central: 6, mega: 5 } },
  { id: "p6", name: "กระโปรงพลีทจีบรอบตัว", sku: "SK-001", category: "กระโปรง", price: 490, image: null, size: "M", chest: null, stock: { siam: 25, central: 0, mega: 3 } },
  { id: "p7", name: "เสื้อฮู้ดผ้าฟลีซ", sku: "HD-001", category: "ฮู้ด/สเวตเตอร์", price: 750, image: null, size: "L", chest: "42", stock: { siam: 33, central: 21, mega: 27 } },
  { id: "p8", name: "เสื้อยืดลายกราฟิก", sku: "TS-002", category: "เสื้อยืด", price: 350, image: null, size: "S", chest: "34-36", stock: { siam: 5, central: 1, mega: 4 } },
  { id: "p9", name: "กางเกงยีนส์ขาม้า", sku: "JN-002", category: "กางเกงยีนส์", price: 950, image: null, size: "32", chest: null, stock: { siam: 11, central: 9, mega: 0 } },
  { id: "p10", name: "เดรสเชิ้ตทำงาน", sku: "DR-002", category: "เดรส", price: 790, image: null, size: "M", chest: "34-36", stock: { siam: 3, central: 7, mega: 6 } },
];

const money = (n) => n.toLocaleString("th-TH");
const combinedQty = (p) => Object.values(p.stock).reduce((s, v) => s + (v || 0), 0);
const LOW_UNIT = 5;
const LOW_TOTAL = 10;
const isToday = (iso) => {
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};
const sizeSpec = (p) => {
  const parts = [];
  if (p.size) parts.push(`ไซส์ ${p.size}`);
  if (p.chest) parts.push(`รอบอก ${p.chest} นิ้ว`);
  return parts.join(" · ");
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" }) +
    " " + d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
};

// ย่อ + บีบภาพให้ไม่เกิน maxBytes จริง ๆ โดยลดคุณภาพ/ขนาดวนไปเรื่อย ๆ จนกว่าจะได้ขนาดตามเป้า
// (กันกรณีถ่ายภาพความละเอียดสูงมากหรือภาพซับซ้อนจนไฟล์ยังใหญ่แม้ย่อขนาดแล้ว)
function readAndResizeImage(file, { maxSize = 240, quality = 0.7, maxBytes = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const drawAt = (size, q) => {
          let { width, height } = img;
          if (width > height && width > size) { height = Math.round((height * size) / width); width = size; }
          else if (height > size) { width = Math.round((width * size) / height); height = size; }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          return canvas.toDataURL("image/jpeg", q);
        };
        const bytesOf = (dataUrl) => Math.ceil((dataUrl.length * 3) / 4); // ประมาณขนาดจริงจาก base64

        let size = maxSize;
        let q = quality;
        let out = drawAt(size, q);

        // รอบที่ 1-6: ลดคุณภาพก่อน (คงขนาดภาพไว้ ให้ยังคมชัด)
        let tries = 0;
        while (bytesOf(out) > maxBytes && q > 0.3 && tries < 6) {
          q -= 0.1;
          out = drawAt(size, q);
          tries += 1;
        }
        // ถ้ายังเกินอยู่: เริ่มลดขนาดภาพลงด้วย
        tries = 0;
        while (bytesOf(out) > maxBytes && size > 80 && tries < 8) {
          size = Math.round(size * 0.85);
          out = drawAt(size, Math.max(q, 0.5));
          tries += 1;
        }

        resolve(out);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ย่อ+บีบภาพในเครื่องก่อน แล้วค่อยอัปโหลดขึ้น Firebase Storage
// คืนค่า { url, path } — url ไว้แสดงรูป, path ไว้ใช้ลบไฟล์เก่าตอนเปลี่ยน/ลบรูป
async function uploadProductImage(file) {
  const dataUrl = await readAndResizeImage(file, { maxSize: 480, quality: 0.8, maxBytes: 400 * 1024 });
  const blob = dataUrlToBlob(dataUrl);
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

// ลบไฟล์เก่าออกจาก Storage แบบ best-effort (ไม่ต้องรอ ไม่ต้องกังวลถ้าล้มเหลว)
function deleteProductImage(path) {
  if (!path) return;
  deleteObject(ref(storage, path)).catch(() => {});
}

  return (
    <div className={`relative rounded-lg border ${className}`} style={{ borderColor: C.line, background: "#FFFFFF", ...style }}>
      <div className="absolute -top-2 left-4 tag-hole" />
      {children}
    </div>
  );
}

function StatusChip({ qty, unit = LOW_UNIT }) {
  const state = qty <= 0 ? "out" : qty < unit ? "low" : "ok";
  const map = {
    ok: { bg: "#EEF1E9", fg: C.moss, label: "ปกติ" },
    low: { bg: "#F3E8D9", fg: C.brassDark, label: "ใกล้หมด" },
    out: { bg: "#F3E0E0", fg: C.wine, label: "หมดสต็อก" },
  }[state];
  return (
    <span className="tag-font-body text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap" style={{ background: map.bg, color: map.fg }}>
      {map.label}
    </span>
  );
}

function MoveChip({ type, qty }) {
  const isIn = type === "in";
  return (
    <span className="tag-font-mono text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap" style={{ background: isIn ? "#EEF1E9" : "#F3E0E0", color: isIn ? C.moss : C.wine }}>
      {isIn ? "▲ รับเข้า" : "▼ ตัดออก"} {qty}
    </span>
  );
}

function ProductThumb({ product, size = 44 }) {
  if (product.image) {
    return <img src={product.image} alt={product.name} className="rounded-md object-cover flex-shrink-0" style={{ width: size, height: size, border: `1px solid ${C.line}` }} />;
  }
  return (
    <div className="rounded-md flex items-center justify-center flex-shrink-0 tag-font-display font-semibold"
      style={{ width: size, height: size, background: C.paperDark, color: C.brassDark, fontSize: size * 0.42 }}>
      {product.name.charAt(0)}
    </div>
  );
}

function BalanceCell({ qty, onMove, big = false }) {
  const btn = big ? "w-8 h-8 text-sm" : "w-7 h-7 text-xs";
  return (
    <div className="flex items-center gap-2">
      <span className={`tag-font-mono font-semibold text-right ${big ? "text-base w-10" : "text-sm w-8"}`}>{qty}</span>
      <button onClick={() => onMove("in")} title="รับเข้า" className={`${btn} rounded flex items-center justify-center font-bold active:scale-95 transition`} style={{ background: "#EEF1E9", color: C.moss }}>▲</button>
      <button onClick={() => onMove("out")} title="ตัดออก" className={`${btn} rounded flex items-center justify-center font-bold active:scale-95 transition`} style={{ background: "#F3E0E0", color: C.wine }}>▼</button>
    </div>
  );
}

export default function StockApp() {
  const [branches, setBranches] = useState(DEFAULT_BRANCHES);
  const [categories, setCategories] = useState(DEFAULT_CATS);
  const [products, setProducts] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [view, setView] = useState("dashboard");
  const [branch, setBranch] = useState("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [renameBranch, setRenameBranch] = useState(null);
  const [moveCtx, setMoveCtx] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef(null);

  // โหลดข้อมูล + ฟังการเปลี่ยนแปลงแบบเรียลไทม์จาก Firestore
  // (ถ้าสาขาอื่นแก้สต็อก หน้าจอนี้จะอัปเดตให้อัตโนมัติ)
  const isRemoteUpdate = useRef(false);

  useEffect(() => {
    const unsub = onSnapshot(
      STOCK_DOC,
      (snap) => {
        if (snap.exists()) {
          const parsed = snap.data();
          isRemoteUpdate.current = true;
          setProducts(parsed.products || seedProducts());
          setTransactions(parsed.transactions || []);
          setBranches(parsed.branches && parsed.branches.length ? parsed.branches : DEFAULT_BRANCHES);
          setCategories(parsed.categories && parsed.categories.length ? parsed.categories : DEFAULT_CATS);
        } else {
          setProducts(seedProducts());
          setTransactions([]);
        }
        setLoaded(true);
      },
      (err) => {
        console.error("Firestore load error:", err);
        setProducts(seedProducts());
        setTransactions([]);
        setLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!loaded || products === null) return;
    // อย่าเขียนกลับขึ้น Firestore ทันทีที่เพิ่งได้ค่ามาจาก Firestore เอง (กันลูป)
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(STOCK_DOC, { products, transactions, branches, categories });
      } catch (e) {
        console.error("Firestore save error:", e);
      }
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [products, transactions, branches, categories, loaded]);

  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;

  const removeProduct = (id) => setProducts((prev) => {
    const target = prev.find((p) => p.id === id);
    if (target?.imagePath) deleteProductImage(target.imagePath);
    return prev.filter((p) => p.id !== id);
  });
  const addProduct = (p) => setProducts((prev) => [{ ...p, id: "p" + Date.now() }, ...prev]);
  const updateProduct = (id, patch) => setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const renameBranchName = (id, name) => setBranches((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
  const addCategory = (name, prefix) => setCategories((prev) => (prev.some((c) => c.name === name) ? prev : [...prev, { name, prefix }]));

  const commitMove = (product, branchId, type, qty, note) => {
    if (!qty || qty <= 0) return { ok: false, error: "กรุณาระบุจำนวนมากกว่า 0" };
    const current = product.stock[branchId] || 0;
    if (type === "out" && qty > current) return { ok: false, error: `คงเหลือมีเพียง ${current} ชิ้น ไม่สามารถตัดออก ${qty} ชิ้นได้` };
    const nextQty = type === "in" ? current + qty : current - qty;
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, stock: { ...p.stock, [branchId]: nextQty } } : p)));
    setTransactions((prev) => [
      { id: "t" + Date.now() + Math.random().toString(36).slice(2, 6), productId: product.id, productName: product.name, sku: product.sku, branchId, type, qty, note: note || "", at: new Date().toISOString() },
      ...prev,
    ]);
    return { ok: true };
  };

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    return products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.includes(q));
  }, [products, search]);

  const stats = useMemo(() => {
    if (!products) return null;
    const totalUnits = products.reduce((s, p) => s + combinedQty(p), 0);
    const totalValue = products.reduce((s, p) => s + combinedQty(p) * p.price, 0);
    const lowStock = products.filter((p) => combinedQty(p) < LOW_TOTAL);
    const perBranch = branches.map((b) => ({
      ...b,
      units: products.reduce((s, p) => s + (p.stock[b.id] || 0), 0),
      value: products.reduce((s, p) => s + (p.stock[b.id] || 0) * p.price, 0),
    }));
    const maxUnits = Math.max(...perBranch.map((b) => b.units), 1);
    const todays = transactions.filter((t) => isToday(t.at));
    const inToday = todays.filter((t) => t.type === "in").reduce((s, t) => s + t.qty, 0);
    const outToday = todays.filter((t) => t.type === "out").reduce((s, t) => s + t.qty, 0);
    return { totalUnits, totalValue, lowStock, perBranch, maxUnits, sku: products.length, inToday, outToday };
  }, [products, transactions, branches]);

  if (!products || !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center tag-font-body" style={{ background: C.paper }}>
        <style>{FONT_CSS}</style>
        <p style={{ color: C.ink }}>กำลังโหลดข้อมูลสต็อก…</p>
      </div>
    );
  }

  const tabs = [
    { k: "dashboard", label: "แดชบอร์ด", icon: "▤" },
    { k: "stock", label: "สต็อกสินค้า", icon: "▦" },
    { k: "history", label: "ประวัติ", icon: "↺" },
  ];

  return (
    <div className="min-h-screen tag-font-body" style={{ background: C.paper, color: C.ink }}>
      <style>{FONT_CSS}</style>

      <header className="sticky top-0 z-30 border-b" style={{ borderColor: C.line, background: C.ink }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-5 py-3 sm:py-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="tag-font-mono text-[10px] sm:text-xs tracking-widest uppercase truncate" style={{ color: C.brass }}>inventory / คลังสต็อก</p>
            <h1 className="tag-font-display text-lg sm:text-2xl md:text-3xl font-semibold truncate" style={{ color: C.paper }}>ระบบจัดการสต็อกร้านเสื้อผ้า</h1>
          </div>
          <div className="hidden sm:flex gap-2 flex-shrink-0">
            {tabs.map((t) => (
              <button key={t.k} onClick={() => setView(t.k)} className="tag-font-body text-sm px-4 py-2 rounded-full transition"
                style={{ background: view === t.k ? C.brass : "transparent", color: view === t.k ? C.ink : C.paper, border: `1px solid ${view === t.k ? C.brass : C.line}` }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* mobile bottom tab bar — thumb reachable, always visible */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t flex" style={{ background: C.ink, borderColor: C.line }}>
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setView(t.k)} className="flex-1 flex flex-col items-center gap-0.5 py-2.5 tag-font-body"
            style={{ color: view === t.k ? C.brass : "#9CA3AF" }}>
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="text-[11px]">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8 pb-24 sm:pb-8">
        {view === "dashboard" && (
          <Dashboard stats={stats} transactions={transactions} branchName={branchName} onGoToStock={(id) => { setView("stock"); setBranch(id); }} />
        )}
        {view === "stock" && (
          <StockView
            branches={branches} branch={branch} setBranch={setBranch} search={search} setSearch={setSearch}
            products={filtered} onDeleteRequest={(p) => setDeleteTarget(p)}
            showAdd={showAdd} setShowAdd={setShowAdd} addProduct={addProduct}
            categories={categories} onAddCategory={addCategory}
            onOpenMove={(product, branchId, type) => setMoveCtx({ product, branchId, type })}
            onEdit={(product) => setEditProduct(product)}
            onRenameBranch={(b) => setRenameBranch(b)}
          />
        )}
        {view === "history" && <HistoryView transactions={transactions} branches={branches} branchName={branchName} />}
      </main>

      <footer className="hidden sm:block tag-font-mono text-xs text-center py-6" style={{ color: C.brassDark }}>
        ข้อมูลและประวัติการเคลื่อนไหวจะถูกบันทึกไว้ให้อัตโนมัติสำหรับบัญชีนี้
      </footer>

      {moveCtx && (
        <MoveModal ctx={moveCtx} branchName={branchName} onClose={() => setMoveCtx(null)}
          onConfirm={(qty, note) => commitMove(moveCtx.product, moveCtx.branchId, moveCtx.type, qty, note)} />
      )}
      {showAdd && <ProductModal mode="add" branches={branches} categories={categories} onAddCategory={addCategory} products={products} onClose={() => setShowAdd(false)} onSave={addProduct} />}
      {editProduct && (
        <ProductModal mode="edit" branches={branches} categories={categories} onAddCategory={addCategory} products={products} product={editProduct} onClose={() => setEditProduct(null)}
          onSave={(patch) => { updateProduct(editProduct.id, patch); setEditProduct(null); }} />
      )}
      {renameBranch && (
        <RenameBranchModal branch={renameBranch} onClose={() => setRenameBranch(null)}
          onSave={(name) => { renameBranchName(renameBranch.id, name); setRenameBranch(null); }} />
      )}
      {deleteTarget && (
        <ConfirmDeleteModal product={deleteTarget} onClose={() => setDeleteTarget(null)}
          onConfirm={() => { removeProduct(deleteTarget.id); setDeleteTarget(null); }} />
      )}

      {/* mobile floating add button on stock tab */}
      {view === "stock" && (
        <button onClick={() => setShowAdd(true)} className="sm:hidden fixed right-4 z-30 w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-lg"
          style={{ bottom: "5.5rem", background: C.brass, color: C.ink }} title="เพิ่มสินค้าใหม่">
          +
        </button>
      )}
    </div>
  );
}

function Dashboard({ stats, transactions, branchName, onGoToStock }) {
  const recent = transactions.slice(0, 6);
  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <HangTag className="p-4 pt-5 sm:p-5 sm:pt-6">
          <p className="tag-font-mono text-[10px] sm:text-xs uppercase tracking-wide" style={{ color: C.brassDark }}>SKU ทั้งหมด</p>
          <p className="tag-font-display text-2xl sm:text-3xl font-semibold mt-1">{stats.sku}</p>
        </HangTag>
        <HangTag className="p-4 pt-5 sm:p-5 sm:pt-6">
          <p className="tag-font-mono text-[10px] sm:text-xs uppercase tracking-wide" style={{ color: C.brassDark }}>คงเหลือรวมทุกสาขา</p>
          <p className="tag-font-display text-2xl sm:text-3xl font-semibold mt-1">{money(stats.totalUnits)}</p>
        </HangTag>
        <HangTag className="p-4 pt-5 sm:p-5 sm:pt-6">
          <p className="tag-font-mono text-[10px] sm:text-xs uppercase tracking-wide" style={{ color: C.moss }}>รับเข้าวันนี้</p>
          <p className="tag-font-display text-2xl sm:text-3xl font-semibold mt-1" style={{ color: C.moss }}>+{money(stats.inToday)}</p>
        </HangTag>
        <HangTag className="p-4 pt-5 sm:p-5 sm:pt-6">
          <p className="tag-font-mono text-[10px] sm:text-xs uppercase tracking-wide" style={{ color: C.wine }}>ตัดออกวันนี้</p>
          <p className="tag-font-display text-2xl sm:text-3xl font-semibold mt-1" style={{ color: C.wine }}>−{money(stats.outToday)}</p>
        </HangTag>
      </div>

      <HangTag className="p-5 pt-6 sm:p-6 sm:pt-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-1">
          <h2 className="tag-font-display text-lg sm:text-xl font-semibold">คงเหลือแยกตามสาขา</h2>
          <span className="tag-font-mono text-xs" style={{ color: C.brassDark }}>มูลค่าสต็อกรวม ฿{money(stats.totalValue)}</span>
        </div>
        <div className="space-y-4">
          {stats.perBranch.map((b) => (
            <button key={b.id} onClick={() => onGoToStock(b.id)} className="w-full text-left group">
              <div className="flex justify-between tag-font-body text-sm mb-1 gap-2">
                <span className="font-medium truncate">{b.name}</span>
                <span className="tag-font-mono flex-shrink-0" style={{ color: C.brassDark }}>{money(b.units)} ชิ้น · ฿{money(b.value)}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden" style={{ background: C.paperDark }}>
                <div className="h-full rounded-full transition-all group-hover:opacity-80" style={{ width: `${(b.units / stats.maxUnits) * 100}%`, background: C.denim }} />
              </div>
            </button>
          ))}
        </div>
      </HangTag>

      <div className="grid md:grid-cols-2 gap-5 sm:gap-6">
        <HangTag className="p-5 pt-6 sm:p-6 sm:pt-7">
          <div className="flex items-center justify-between mb-4 tag-perf pt-4 -mt-4">
            <h2 className="tag-font-display text-base sm:text-lg font-semibold">ต้องเติมสต็อก</h2>
            <span className="tag-font-mono text-[11px] sm:text-xs" style={{ color: C.wine }}>รวม &lt; {LOW_TOTAL}</span>
          </div>
          {stats.lowStock.length === 0 ? (
            <p className="text-sm py-4" style={{ color: C.brassDark }}>ยังไม่มีสินค้าที่ใกล้หมด สต็อกอยู่ในระดับปกติ</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: C.line }}>
              {stats.lowStock.map((p) => (
                <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <ProductThumb product={p} size={32} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="tag-font-mono text-xs" style={{ color: C.brassDark }}>{p.sku}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="tag-font-mono text-sm hidden sm:inline">{combinedQty(p)} ชิ้น</span>
                    <StatusChip qty={combinedQty(p)} unit={LOW_TOTAL} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </HangTag>

        <HangTag className="p-5 pt-6 sm:p-6 sm:pt-7">
          <div className="flex items-center justify-between mb-4 tag-perf pt-4 -mt-4">
            <h2 className="tag-font-display text-base sm:text-lg font-semibold">ความเคลื่อนไหวล่าสุด</h2>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm py-4" style={{ color: C.brassDark }}>ยังไม่มีการรับเข้า/ตัดออกสต็อก</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: C.line }}>
              {recent.map((t) => (
                <li key={t.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.productName}</p>
                    <p className="tag-font-mono text-xs truncate" style={{ color: C.brassDark }}>{branchName(t.branchId)} · {fmtDate(t.at)}</p>
                  </div>
                  <div className="flex-shrink-0"><MoveChip type={t.type} qty={t.qty} /></div>
                </li>
              ))}
            </ul>
          )}
        </HangTag>
      </div>
    </div>
  );
}

function StockView({ branches, branch, setBranch, search, setSearch, products, onDeleteRequest, showAdd, setShowAdd, addProduct, categories, onAddCategory, onOpenMove, onEdit, onRenameBranch }) {
  const branchName = (id) => branches.find((b) => b.id === id)?.name || id;
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* branch tag-tabs — horizontally scrollable strip on phone, wraps on desktop */}
      <div className="flex gap-2 sm:gap-3 overflow-x-auto sm:overflow-visible sm:flex-wrap pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
        <button onClick={() => setBranch("all")} className="relative flex-shrink-0 tag-font-body text-sm px-4 py-2 pl-6 rounded-md border transition"
          style={{ background: branch === "all" ? C.denim : "#FFFFFF", color: branch === "all" ? "#FFFFFF" : C.ink, borderColor: branch === "all" ? C.denim : C.line }}>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full" style={{ width: 6, height: 6, background: branch === "all" ? "#FFFFFF" : C.brass }} />
          รวมทุกสาขา
        </button>
        {branches.map((b) => (
          <div key={b.id} className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setBranch(b.id)} className="relative tag-font-body text-sm px-4 py-2 pl-6 rounded-md border transition whitespace-nowrap"
              style={{ background: branch === b.id ? C.denim : "#FFFFFF", color: branch === b.id ? "#FFFFFF" : C.ink, borderColor: branch === b.id ? C.denim : C.line }}>
              <span className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full" style={{ width: 6, height: 6, background: branch === b.id ? "#FFFFFF" : C.brass }} />
              {b.name}
            </button>
            <button onClick={() => onRenameBranch(b)} title="แก้ไขชื่อสาขา" className="w-8 h-8 rounded-md flex items-center justify-center text-xs flex-shrink-0"
              style={{ background: "#FFFFFF", border: `1px solid ${C.line}`, color: C.brassDark }}>
              ✎
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อสินค้า, SKU หรือหมวดหมู่…"
          className="w-full sm:max-w-xs px-4 py-2.5 sm:py-2 rounded-md border tag-font-body text-sm" style={{ borderColor: C.line, background: "#FFFFFF" }} />
        <button onClick={() => setShowAdd(true)} className="hidden sm:block tag-font-body text-sm px-4 py-2 rounded-md font-medium" style={{ background: C.brass, color: C.ink }}>
          + เพิ่มสินค้าใหม่
        </button>
      </div>

      {products.length === 0 && (
        <HangTag className="p-10 text-center">
          <p className="text-sm" style={{ color: C.brassDark }}>ไม่พบสินค้าตรงกับคำค้นหา</p>
        </HangTag>
      )}

      {/* ---- Desktop / tablet: table ---- */}
      {products.length > 0 && (
        <HangTag className="hidden md:block overflow-hidden">
          <div className="grid tag-font-mono text-xs uppercase tracking-wide px-5 py-3"
            style={{ gridTemplateColumns: branch === "all" ? `2.2fr 0.7fr ${branches.map(() => "1.2fr").join(" ")} 0.9fr 1fr` : "2.6fr 0.7fr 1.2fr 0.9fr 1fr", background: C.paperDark, color: C.brassDark }}>
            <span>สินค้า / SKU</span>
            <span>ราคา</span>
            {branch === "all" ? (
              <>
                {branches.map((b) => <span key={b.id} className="truncate">{b.name.replace("สาขา", "")}</span>)}
                <span>สถานะ</span>
              </>
            ) : (
              <>
                <span>คงเหลือ ({branchName(branch)})</span>
                <span>สถานะ</span>
              </>
            )}
            <span></span>
          </div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            {products.map((p) => {
              const total = combinedQty(p);
              const branchQty = branch === "all" ? total : p.stock[branch] || 0;
              return (
                <div key={p.id} className="grid px-5 py-4 items-center"
                  style={{ gridTemplateColumns: branch === "all" ? `2.2fr 0.7fr ${branches.map(() => "1.2fr").join(" ")} 0.9fr 1fr` : "2.6fr 0.7fr 1.2fr 0.9fr 1fr" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <ProductThumb product={p} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="tag-font-mono text-xs truncate" style={{ color: C.brassDark }}>{p.sku} · {p.category}</p>
                      {sizeSpec(p) && <p className="tag-font-mono text-xs truncate" style={{ color: C.brass }}>{sizeSpec(p)}</p>}
                    </div>
                  </div>
                  <div className="tag-font-mono text-sm">฿{money(p.price)}</div>
                  {branch === "all" ? (
                    <>
                      {branches.map((b) => (
                        <div key={b.id}><BalanceCell qty={p.stock[b.id] || 0} onMove={(type) => onOpenMove(p, b.id, type)} /></div>
                      ))}
                      <div>
                        <StatusChip qty={total} unit={LOW_TOTAL} />
                        <p className="tag-font-mono text-xs mt-1" style={{ color: C.brassDark }}>{total} ชิ้นรวม</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div><BalanceCell qty={branchQty} onMove={(type) => onOpenMove(p, branch, type)} /></div>
                      <div><StatusChip qty={branchQty} unit={LOW_UNIT} /></div>
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => onEdit(p)} className="tag-font-mono text-xs px-2 py-1 rounded" style={{ color: C.denim }}>แก้ไข</button>
                    <button onClick={() => onDeleteRequest(p)} className="tag-font-mono text-xs px-2 py-1 rounded" style={{ color: C.wine }} title="ลบสินค้า">ลบ</button>
                  </div>
                </div>
              );
            })}
          </div>
        </HangTag>
      )}

      {/* ---- Phone: stacked cards ---- */}
      {products.length > 0 && (
        <div className="md:hidden space-y-3">
          {products.map((p) => {
            const total = combinedQty(p);
            return (
              <HangTag key={p.id} className="p-4 pt-5">
                <div className="flex items-start gap-3 mb-3">
                  <ProductThumb product={p} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{p.name}</p>
                    <p className="tag-font-mono text-xs mt-0.5" style={{ color: C.brassDark }}>{p.sku} · {p.category}</p>
                    {sizeSpec(p) && <p className="tag-font-mono text-xs mt-0.5" style={{ color: C.brass }}>{sizeSpec(p)}</p>}
                    <p className="tag-font-mono text-sm font-semibold mt-1">฿{money(p.price)}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <StatusChip qty={branch === "all" ? total : (p.stock[branch] || 0)} unit={branch === "all" ? LOW_TOTAL : LOW_UNIT} />
                  </div>
                </div>

                <div className="tag-perf pt-3 space-y-2">
                  {(branch === "all" ? branches : branches.filter((b) => b.id === branch)).map((b) => (
                    <div key={b.id} className="flex items-center justify-between">
                      <span className="tag-font-body text-sm truncate pr-2" style={{ color: C.brassDark }}>{b.name}</span>
                      <BalanceCell qty={p.stock[b.id] || 0} onMove={(type) => onOpenMove(p, b.id, type)} big />
                    </div>
                  ))}
                  {branch === "all" && (
                    <div className="flex items-center justify-between pt-1 tag-perf">
                      <span className="tag-font-body text-sm font-medium">รวมทั้งหมด</span>
                      <span className="tag-font-mono text-base font-semibold">{total} ชิ้น</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mt-3">
                  <button onClick={() => onEdit(p)} className="flex-1 py-2 rounded-md text-sm font-medium border" style={{ borderColor: C.denim, color: C.denim }}>แก้ไข</button>
                  <button onClick={() => onDeleteRequest(p)} className="flex-1 py-2 rounded-md text-sm font-medium border" style={{ borderColor: C.wine, color: C.wine }}>ลบ</button>
                </div>
              </HangTag>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryView({ transactions, branches, branchName }) {
  const [branchFilter, setBranchFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return transactions.filter((t) => {
      if (branchFilter !== "all" && t.branchId !== branchFilter) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (q.trim() && !(t.productName.toLowerCase().includes(q.toLowerCase()) || t.sku.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [transactions, branchFilter, typeFilter, q]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาสินค้า หรือ SKU…"
          className="w-full sm:max-w-xs px-4 py-2.5 sm:py-2 rounded-md border tag-font-body text-sm" style={{ borderColor: C.line, background: "#FFFFFF" }} />
        <div className="flex gap-2">
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="flex-1 sm:flex-none px-3 py-2 rounded-md border tag-font-body text-sm" style={{ borderColor: C.line, background: "#FFFFFF" }}>
            <option value="all">ทุกสาขา</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="flex-1 sm:flex-none px-3 py-2 rounded-md border tag-font-body text-sm" style={{ borderColor: C.line, background: "#FFFFFF" }}>
            <option value="all">รับเข้า + ตัดออก</option>
            <option value="in">รับเข้าเท่านั้น</option>
            <option value="out">ตัดออกเท่านั้น</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <HangTag className="p-10 text-center">
          <p className="text-sm" style={{ color: C.brassDark }}>ยังไม่มีประวัติการเคลื่อนไหวตามเงื่อนไขนี้</p>
        </HangTag>
      ) : (
        <>
          {/* Desktop table */}
          <HangTag className="hidden md:block overflow-hidden">
            <div className="grid tag-font-mono text-xs uppercase tracking-wide px-5 py-3" style={{ gridTemplateColumns: "1.6fr 1.3fr 1fr 1fr 1.6fr", background: C.paperDark, color: C.brassDark }}>
              <span>สินค้า</span><span>สาขา</span><span>ประเภท</span><span>จำนวน</span><span>วันที่ / หมายเหตุ</span>
            </div>
            <div className="divide-y" style={{ borderColor: C.line }}>
              {rows.map((t) => (
                <div key={t.id} className="grid px-5 py-3 items-center" style={{ gridTemplateColumns: "1.6fr 1.3fr 1fr 1fr 1.6fr" }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.productName}</p>
                    <p className="tag-font-mono text-xs" style={{ color: C.brassDark }}>{t.sku}</p>
                  </div>
                  <div className="tag-font-body text-sm truncate">{branchName(t.branchId)}</div>
                  <div><MoveChip type={t.type} qty="" /></div>
                  <div className="tag-font-mono text-sm font-semibold">{t.type === "in" ? "+" : "−"}{t.qty}</div>
                  <div className="tag-font-mono text-xs truncate" style={{ color: C.brassDark }}>{fmtDate(t.at)}{t.note ? ` · ${t.note}` : ""}</div>
                </div>
              ))}
            </div>
          </HangTag>

          {/* Phone cards */}
          <div className="md:hidden space-y-3">
            {rows.map((t) => (
              <HangTag key={t.id} className="p-4 pt-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.productName}</p>
                    <p className="tag-font-mono text-xs" style={{ color: C.brassDark }}>{t.sku}</p>
                  </div>
                  <MoveChip type={t.type} qty={t.qty} />
                </div>
                <div className="tag-perf pt-2 flex items-center justify-between text-xs tag-font-mono" style={{ color: C.brassDark }}>
                  <span>{branchName(t.branchId)}</span>
                  <span>{fmtDate(t.at)}</span>
                </div>
                {t.note && <p className="tag-font-body text-xs mt-1" style={{ color: C.brassDark }}>หมายเหตุ: {t.note}</p>}
              </HangTag>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MoveModal({ ctx, branchName, onClose, onConfirm }) {
  const { product, branchId, type } = ctx;
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const isIn = type === "in";
  const current = product.stock[branchId] || 0;

  const submit = () => {
    const n = parseInt(qty || "0", 10);
    const res = onConfirm(n, note);
    if (!res.ok) { setError(res.error); return; }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(35,38,43,0.55)" }}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-lg p-6 relative max-h-[90vh] overflow-y-auto" style={{ background: C.paper }}>
        <div className="hidden sm:block absolute -top-2 left-6 tag-hole" style={{ background: C.paper }} />
        <p className="tag-font-mono text-xs uppercase tracking-wide" style={{ color: isIn ? C.moss : C.wine }}>
          {isIn ? "รับเข้าสต็อก" : "ตัดออกสต็อก"} · {branchName(branchId)}
        </p>
        <h3 className="tag-font-display text-lg font-semibold mt-1 mb-1">{product.name}</h3>
        <p className="tag-font-mono text-xs mb-4" style={{ color: C.brassDark }}>คงเหลือปัจจุบัน {current} ชิ้น</p>

        <div className="space-y-3 tag-font-body text-sm">
          <div>
            <label className="block mb-1" style={{ color: C.brassDark }}>จำนวน</label>
            <input type="number" min="1" inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setError(""); }}
              className="w-full px-3 py-2.5 rounded border tag-font-mono text-base" style={{ borderColor: C.line }} autoFocus />
          </div>
          <div>
            <label className="block mb-1" style={{ color: C.brassDark }}>หมายเหตุ (ถ้ามี)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={isIn ? "เช่น รับสินค้าจากผู้ผลิต" : "เช่น ขายหน้าร้าน, โอนสาขา"}
              className="w-full px-3 py-2.5 rounded border" style={{ borderColor: C.line }} />
          </div>
          {error && <p className="text-xs" style={{ color: C.wine }}>{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 sm:py-2 rounded-md text-sm border" style={{ borderColor: C.line }}>ยกเลิก</button>
          <button onClick={submit} className="flex-1 py-3 sm:py-2 rounded-md text-sm font-medium" style={{ background: isIn ? C.moss : C.wine, color: "#FFFFFF" }}>
            ยืนยัน{isIn ? "รับเข้า" : "ตัดออก"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductModal({ mode, branches, categories, onAddCategory, product, products, onClose, onSave }) {
  const isEdit = mode === "edit";
  const [name, setName] = useState(product?.name || "");
  const [sku, setSku] = useState(product?.sku || "");
  const [category, setCategory] = useState(product?.category || categories[0]?.name || "");
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newCatPrefix, setNewCatPrefix] = useState("");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [size, setSize] = useState(product?.size || "");
  const [chest, setChest] = useState(product?.chest || "");
  const [image, setImage] = useState(product?.image || null);
  const [imagePath, setImagePath] = useState(product?.imagePath || null);
  const [stock, setStock] = useState(() => {
    const base = {};
    branches.forEach((b) => { base[b.id] = product ? String(product.stock[b.id] || 0) : ""; });
    return base;
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // add mode: SKU always tracks the selected category automatically
  useEffect(() => {
    if (!isEdit && category) setSku(generateSku(category, categories, products));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, categories.length]);

  const canSave = name.trim() && sku.trim() && price !== "";

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url, path } = await uploadProductImage(file);
      // ลบรูปเก่าออกจาก Storage เพื่อไม่ให้ไฟล์ค้าง (ถ้ามี)
      if (imagePath) deleteProductImage(imagePath);
      setImage(url);
      setImagePath(path);
    } catch (err) {
      console.error("อัปโหลดรูปภาพไม่สำเร็จ:", err);
    }
    setUploading(false);
  };

  const handleRemoveImage = () => {
    if (imagePath) deleteProductImage(imagePath);
    setImage(null);
    setImagePath(null);
  };

  const handleCategoryChange = (val) => {
    if (val === NEW_CAT_VALUE) {
      setAddingCat(true);
      setNewCat("");
      setNewCatPrefix("");
    } else {
      setCategory(val);
    }
  };

  const confirmNewCategory = () => {
    const trimmedName = newCat.trim();
    if (!trimmedName) return;
    const prefix = (newCatPrefix.trim() || suggestPrefix(trimmedName, categories)).toUpperCase();
    onAddCategory(trimmedName, prefix);
    setCategory(trimmedName);
    setAddingCat(false);
  };

  const save = () => {
    if (!canSave) return;
    const patch = {
      name: name.trim(), sku: sku.trim(), category, price: parseFloat(price) || 0, image, imagePath,
      size: size.trim() || null,
      chest: chest.trim() ? chest.trim() : null,
    };
    if (!isEdit) {
      const stockObj = {};
      branches.forEach((b) => { stockObj[b.id] = parseInt(stock[b.id] || "0", 10); });
      patch.stock = stockObj;
    }
    onSave(patch);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(35,38,43,0.55)" }}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-lg p-6 relative max-h-[92vh] overflow-y-auto" style={{ background: C.paper }}>
        <div className="hidden sm:block absolute -top-2 left-6 tag-hole" style={{ background: C.paper }} />
        <h3 className="tag-font-display text-xl font-semibold mb-4">{isEdit ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h3>

        <div className="space-y-3 tag-font-body text-sm">
          <div className="flex items-center gap-4">
            <div className="relative">
              {image ? (
                <img src={image} alt="preview" className="w-20 h-20 rounded-md object-cover" style={{ border: `1px solid ${C.line}` }} />
              ) : (
                <div className="w-20 h-20 rounded-md flex items-center justify-center tag-font-mono text-xs text-center px-2" style={{ background: C.paperDark, color: C.brassDark }}>ไม่มีรูป</div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="tag-font-body text-xs px-3 py-2 sm:py-1.5 rounded-md border" style={{ borderColor: C.line }}>
                {uploading ? "กำลังอัปโหลด…" : image ? "เปลี่ยนรูปภาพ" : "อัปโหลดรูปภาพ"}
              </button>
              {image && <button type="button" onClick={handleRemoveImage} className="tag-font-mono text-xs" style={{ color: C.wine }}>ลบรูปภาพ</button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </div>
          </div>

          <div>
            <label className="block mb-1" style={{ color: C.brassDark }}>ชื่อสินค้า</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded border text-base" style={{ borderColor: C.line }} />
          </div>

          <div>
            <label className="block mb-1" style={{ color: C.brassDark }}>หมวดหมู่</label>
            {!addingCat ? (
              <select value={category} onChange={(e) => handleCategoryChange(e.target.value)} className="w-full px-3 py-2.5 rounded border text-base" style={{ borderColor: C.line }}>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                <option value={NEW_CAT_VALUE}>+ เพิ่มหมวดหมู่ใหม่…</option>
              </select>
            ) : (
              <div className="space-y-2 p-3 rounded-md" style={{ background: C.paperDark }}>
                <div>
                  <label className="block mb-1 text-xs" style={{ color: C.brassDark }}>ชื่อหมวดหมู่ใหม่</label>
                  <input value={newCat} onChange={(e) => setNewCat(e.target.value)} autoFocus placeholder="เช่น รองเท้า"
                    className="w-full px-3 py-2 rounded border text-base" style={{ borderColor: C.line, background: "#FFF" }} />
                </div>
                <div>
                  <label className="block mb-1 text-xs" style={{ color: C.brassDark }}>ตัวย่อสำหรับ SKU (แก้ไขได้)</label>
                  <input value={newCatPrefix || (newCat ? suggestPrefix(newCat, categories) : "")} onChange={(e) => setNewCatPrefix(e.target.value.toUpperCase())}
                    placeholder="เช่น SH" maxLength={5}
                    className="w-full px-3 py-2 rounded border tag-font-mono uppercase text-base" style={{ borderColor: C.line, background: "#FFF" }} />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={confirmNewCategory} className="flex-1 px-3 py-2 rounded-md text-sm font-medium" style={{ background: C.brass, color: C.ink }}>เพิ่มหมวดหมู่</button>
                  <button type="button" onClick={() => setAddingCat(false)} className="flex-1 px-3 py-2 rounded-md text-sm border" style={{ borderColor: C.line, background: "#FFF" }}>ยกเลิก</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1" style={{ color: C.brassDark }}>รหัส SKU</label>
              {isEdit ? (
                <input value={sku} onChange={(e) => setSku(e.target.value)} className="w-full px-3 py-2.5 rounded border tag-font-mono text-base" style={{ borderColor: C.line }} />
              ) : (
                <div className="w-full px-3 py-2.5 rounded border tag-font-mono text-base" style={{ borderColor: C.line, background: C.paperDark, color: C.brassDark }}>
                  {sku || "—"}
                </div>
              )}
              {!isEdit && <p className="tag-font-mono text-[11px] mt-1" style={{ color: C.brassDark }}>สร้างอัตโนมัติตามหมวดหมู่</p>}
            </div>
            <div>
              <label className="block mb-1" style={{ color: C.brassDark }}>ราคา (บาท)</label>
              <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full px-3 py-2.5 rounded border tag-font-mono text-base" style={{ borderColor: C.line }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block mb-1" style={{ color: C.brassDark }}>ไซส์</label>
              <input list="size-presets" value={size} onChange={(e) => setSize(e.target.value)} placeholder="เช่น M, Free Size"
                className="w-full px-3 py-2.5 rounded border text-base" style={{ borderColor: C.line }} />
              <datalist id="size-presets">
                {SIZE_PRESETS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div>
              <label className="block mb-1" style={{ color: C.brassDark }}>รอบอก (นิ้ว)</label>
              <input value={chest} onChange={(e) => setChest(e.target.value)} placeholder="เช่น 38 หรือ 32-35"
                className="w-full px-3 py-2.5 rounded border tag-font-mono text-base" style={{ borderColor: C.line }} />
            </div>
          </div>

          {!isEdit && (
            <div>
              <label className="block mb-2" style={{ color: C.brassDark }}>จำนวนเริ่มต้นต่อสาขา (คงเหลือตั้งต้น)</label>
              <div className="grid grid-cols-3 gap-2">
                {branches.map((b) => (
                  <div key={b.id}>
                    <p className="tag-font-mono text-xs mb-1 truncate" style={{ color: C.brassDark }}>{b.name.replace("สาขา", "")}</p>
                    <input type="number" inputMode="numeric" value={stock[b.id]} onChange={(e) => setStock((s) => ({ ...s, [b.id]: e.target.value }))}
                      className="w-full px-2 py-2 rounded border tag-font-mono text-sm" style={{ borderColor: C.line }} />
                  </div>
                ))}
              </div>
              <p className="tag-font-mono text-xs mt-2" style={{ color: C.brassDark }}>หลังบันทึกแล้ว ปรับจำนวนได้ผ่านปุ่มรับเข้า/ตัดออกในหน้าสต็อกสินค้า</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6 sticky bottom-0 bg-inherit pt-2" style={{ background: C.paper }}>
          <button onClick={onClose} className="flex-1 py-3 sm:py-2 rounded-md text-sm border" style={{ borderColor: C.line }}>ยกเลิก</button>
          <button onClick={save} disabled={!canSave} className="flex-1 py-3 sm:py-2 rounded-md text-sm font-medium"
            style={{ background: canSave ? C.brass : C.paperDark, color: canSave ? C.ink : C.brassDark }}>
            {isEdit ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameBranchModal({ branch, onClose, onSave }) {
  const [name, setName] = useState(branch.name);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(35,38,43,0.55)" }}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-lg p-6 relative" style={{ background: C.paper }}>
        <div className="hidden sm:block absolute -top-2 left-6 tag-hole" style={{ background: C.paper }} />
        <h3 className="tag-font-display text-lg font-semibold mb-4">แก้ไขชื่อสาขา</h3>
        <label className="block mb-1 tag-font-body text-sm" style={{ color: C.brassDark }}>ชื่อสาขา</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
          className="w-full px-3 py-2.5 rounded border tag-font-body text-base" style={{ borderColor: C.line }} />
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 sm:py-2 rounded-md text-sm border tag-font-body" style={{ borderColor: C.line }}>ยกเลิก</button>
          <button onClick={() => name.trim() && onSave(name.trim())} className="flex-1 py-3 sm:py-2 rounded-md text-sm font-medium tag-font-body" style={{ background: C.brass, color: C.ink }}>
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ product, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(35,38,43,0.55)" }}>
      <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-lg p-6 relative" style={{ background: C.paper }}>
        <div className="hidden sm:block absolute -top-2 left-6 tag-hole" style={{ background: C.paper }} />
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: "#F3E0E0", color: C.wine }}>!</div>
          <h3 className="tag-font-display text-lg font-semibold">ยืนยันการลบสินค้า</h3>
        </div>
        <p className="tag-font-body text-sm" style={{ color: C.brassDark }}>
          ต้องการลบ <span className="font-semibold" style={{ color: C.ink }}>{product.name}</span> ({product.sku}) ใช่หรือไม่? การลบนี้ไม่สามารถย้อนกลับได้
        </p>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 sm:py-2 rounded-md text-sm border tag-font-body" style={{ borderColor: C.line }}>ยกเลิก</button>
          <button onClick={onConfirm} className="flex-1 py-3 sm:py-2 rounded-md text-sm font-medium tag-font-body" style={{ background: C.wine, color: "#FFFFFF" }}>
            ลบสินค้า
          </button>
        </div>
      </div>
    </div>
  );
}
