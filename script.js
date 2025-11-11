// --- Tab switching based on ?tab= parameter ---
const params = new URLSearchParams(window.location.search);
let activeTab = params.get("tab") || "feed";

function showTab(tabName) {
  document.querySelectorAll(".tab").forEach(tab => tab.classList.add("hidden"));
  const activeElement = document.getElementById(tabName);
  if (activeElement) {
    activeElement.classList.remove("hidden");
  }

  // Update active nav style
  document.querySelectorAll(".nav-item").forEach(link => {
    if (link.dataset.tab === tabName) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

showTab(activeTab);

// --- Update tab on navigation ---
document.querySelectorAll(".nav-item").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault(); // avoid full page reload
    const tabName = link.dataset.tab;
    history.pushState({ tab: tabName }, "", `?tab=${tabName}`);
    showTab(tabName);
  });
});

window.addEventListener("popstate", (e) => {
  const tab = (e.state && e.state.tab) || new URLSearchParams(window.location.search).get("tab") || "feed";
  showTab(tab);
});

// --- Local time updater with formatting ---
function updateTime() {
  const now = new Date();
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const timeElement = document.getElementById("local-time");
  if (timeElement) {
    timeElement.textContent = timeString;
  }
}

updateTime();
setInterval(updateTime, 1000);

// --- Add seasonal greeting ---
function getSeasonalGreeting() {
  const month = new Date().getMonth();
  const greetings = {
    autumn: "🍂 Welcome to autumn's golden hour...",
    default: "Welcome..."
  };
  
  return (month >= 8 && month <= 10) ? greetings.autumn : greetings.default;
}

console.log(getSeasonalGreeting());

// === Encrypted "likes" feature using Web Crypto API ===

/*
  Behavior:
  - Adds a "Like" button to each .post element.
  - Liked post IDs are stored encrypted in localStorage under key 'encrypted_likes'.
  - A symmetric AES-GCM key is generated per browser session (stored raw in sessionStorage).
  - This prevents plaintext like data in localStorage; key is ephemeral per session.
  - Note: client-side encryption only deters casual inspection; not a substitute for server-side auth.
*/

const STORAGE_KEY = "encrypted_likes";
const SESSION_KEY_KEY = "session_aes_key_raw_b64";

// --- helpers ---
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// get or create a session AES-GCM key
async function getSessionKey() {
  try {
    const rawB64 = sessionStorage.getItem(SESSION_KEY_KEY);
    if (rawB64) {
      const raw = base64ToArrayBuffer(rawB64);
      return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
    }
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const exported = await crypto.subtle.exportKey("raw", key);
    sessionStorage.setItem(SESSION_KEY_KEY, arrayBufferToBase64(exported));
    return key;
  } catch (err) {
    console.error("getSessionKey:", err);
    throw err;
  }
}

async function encryptJSON(obj) {
  const key = await getSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce recommended for AES-GCM
  const enc = new TextEncoder();
  const pt = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  // store iv + ciphertext
  const combined = new Uint8Array(iv.byteLength + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.byteLength);
  return arrayBufferToBase64(combined.buffer);
}

async function decryptJSON(b64) {
  if (!b64) return null;
  try {
    const combined = base64ToArrayBuffer(b64);
    const combinedBytes = new Uint8Array(combined);
    const iv = combinedBytes.slice(0, 12);
    const ct = combinedBytes.slice(12);
    const key = await getSessionKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct.buffer);
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(plain));
  } catch (err) {
    console.warn("decryptJSON failed (data may be corrupt or key changed):", err);
    return null;
  }
}

// --- likes storage ---
async function saveLikes(likesArray) {
  try {
    const cipher = await encryptJSON(likesArray);
    localStorage.setItem(STORAGE_KEY, cipher);
  } catch (err) {
    console.error("saveLikes failed:", err);
  }
}

async function loadLikes() {
  try {
    const cipher = localStorage.getItem(STORAGE_KEY);
    if (!cipher) return [];
    const data = await decryptJSON(cipher);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("loadLikes error:", err);
    return [];
  }
}

// --- UI wiring ---
(async function initLikesUI() {
  try {
    const posts = Array.from(document.querySelectorAll(".post"));
    // assign stable ids if not present
    posts.forEach((post, i) => {
      if (!post.dataset.id) {
        // use index + title fallback
        const title = (post.querySelector("h2") && post.querySelector("h2").textContent) || `post-${i}`;
        // simple safe id: base64 of title + i
        post.dataset.id = btoa(encodeURIComponent(title)).replace(/=+$/, "") + "-" + i;
      }
    });

    const likedIds = new Set(await loadLikes());

    // add like buttons
    posts.forEach(post => {
      let btn = post.querySelector(".like-btn");
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "like-btn";
        btn.style.marginTop = "12px";
        btn.style.cursor = "pointer";
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = "🍂 Like";
        post.appendChild(btn);
      }

      const id = post.dataset.id;
      const updateBtn = () => {
        const pressed = likedIds.has(id);
        btn.setAttribute("aria-pressed", pressed ? "true" : "false");
        btn.textContent = pressed ? "🍁 Liked" : "🍂 Like";
        btn.style.fontWeight = pressed ? "700" : "600";
        btn.style.color = pressed ? "var(--link)" : "var(--accent)";
      };

      updateBtn();

      btn.addEventListener("click", async () => {
        if (likedIds.has(id)) likedIds.delete(id);
        else likedIds.add(id);
        updateBtn();
        await saveLikes(Array.from(likedIds));
      });
    });
  } catch (err) {
    console.error("initLikesUI:", err);
  }
})();

/* === Writeups tab script ===
   Adds lightweight client-side search / filter / sort for the writeups tab.
*/
(function writeupsModule(){
  const WRITEUPS = [
    {
      title: "things",
      path: "writeups/things.html",
      date: "2025-11-07",
      tags: ["web"],
      difficulty: 2,
      summary: "section"
    }
    // add more entries here
  ];

  const listEl = document.getElementById('writeups-list');
  const searchInput = document.getElementById('search-w');
  const tagFilter = document.getElementById('filterTag-w');
  const sortBy = document.getElementById('sortBy-w');

  if (!listEl) return; // writeups tab not present

  function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

  function uniqueTags(items){
    const s = new Set();
    items.forEach(it => (it.tags||[]).forEach(t => s.add(t)));
    return [...s].sort();
  }

  function renderList(items){
    listEl.innerHTML = '';
    if(items.length === 0){
      listEl.innerHTML = '<div style="padding:18px;border-radius:10px;background:rgba(0,0,0,0.02);color:var(--text-soft)">No writeups found. Try clearing filters.</div>';
      return;
    }
    items.forEach(w => {
      const card = document.createElement('article');
      card.style.cssText = "background:var(--surface);padding:12px;border-radius:10px;margin-bottom:10px;border:1px solid var(--border)";
      card.innerHTML = `
        <h3 style="margin:0 0 6px 0;font-size:1rem"><a href="${w.path}" style="color:var(--link);text-decoration:none">${escapeHtml(w.title)}</a></h3>
        <div style="font-size:12px;color:var(--text-soft);display:flex;gap:8px;flex-wrap:wrap">
          <span>${w.date}</span>
          <span style="background:#f3f4f6;padding:4px 8px;border-radius:999px;border:1px solid var(--border)">Diff: ${w.difficulty}</span>
          ${(w.tags||[]).map(t=> `<span style="background:#f3f4f6;padding:4px 8px;border-radius:999px;border:1px solid var(--border)">${escapeHtml(t)}</span>`).join(' ')}
        </div>
        <p style="margin-top:8px;color:var(--text-soft)">${escapeHtml(w.summary||'')}</p>
      `;
      listEl.appendChild(card);
    });
  }

  function applyFilters(){
    const q = (searchInput.value||'').toLowerCase().trim();
    const tag = tagFilter.value;
    let items = WRITEUPS.slice();
    if(tag) items = items.filter(i => (i.tags||[]).includes(tag));
    if(q) items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.summary||'').toLowerCase().includes(q) ||
      (i.tags||[]).join(' ').toLowerCase().includes(q)
    );
    if(sortBy.value === 'date') items.sort((a,b)=> b.date.localeCompare(a.date));
    else if(sortBy.value === 'difficulty') items.sort((a,b)=> b.difficulty - a.difficulty);
    renderList(items);
  }

  function init(){
    const tags = uniqueTags(WRITEUPS);
    tags.forEach(t=>{
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t; tagFilter.appendChild(opt);
    });
    renderList(WRITEUPS);
    searchInput.addEventListener('input', applyFilters);
    tagFilter.addEventListener('change', applyFilters);
    sortBy.addEventListener('change', applyFilters);
  }

  init();
})();
