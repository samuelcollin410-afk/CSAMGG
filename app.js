"unl -ba app.js | sed -n '440,470p'e strict";

const home = document.getElementById("home");
const shell = document.getElementById("shell");

const burger = document.getElementById("burger");
const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("backdrop");
const backHome = document.getElementById("backHome");
const topBrand = document.getElementById("topBrand");

const search = document.getElementById("search");
const grid = document.getElementById("grid");

const pageGames = document.getElementById("page-games");
const pageSettings = document.getElementById("page-settings");
const pageCredits = document.getElementById("page-credits");

const playerArea = document.getElementById("playerArea");
const player = document.getElementById("player");
const playerName = document.getElementById("playerName");
const playerType = document.getElementById("playerType");
const closeGame = document.getElementById("closeGame");
const openNewTab = document.getElementById("openNewTab");
const fitModeBtn = document.getElementById("fitModeBtn");
const theaterBtn = document.getElementById("theaterBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

const pageGame = document.getElementById("page-game");

// Game page player elements
const gamePlayerArea = document.getElementById("gamePlayerArea");
const gamePlayer = document.getElementById("gamePlayer");
const gamePlayerName = document.getElementById("gamePlayerName");
const gamePlayerType = document.getElementById("gamePlayerType");
const gameTitle = document.getElementById("gameTitle");
const gameDesc = document.getElementById("gameDesc");


const gameOpenNewTab = document.getElementById("gameOpenNewTab");

const gameFullscreenBtn = document.getElementById("gameFullscreenBtn");

let GAMES = [];
let activeRoute = "games";
let activeGame = null;
let fitMode = "fit"; // "fit" or "fill"
let theaterOn = false;


function cleanupUI(){
  // Close drawer + remove backdrop
  drawer.classList.remove("open");
  backdrop.classList.add("hidden");

  // Release pointer lock if a game grabbed it
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
}

function applyPlayerModes(){
  // fit/fill classes
  playerArea.classList.toggle("fit", fitMode === "fit");
  playerArea.classList.toggle("fill", fitMode === "fill");
  fitModeBtn.textContent = (fitMode === "fit") ? "Fit" : "Fill";

  // theater class
  playerArea.classList.toggle("theater", theaterOn);
  theaterBtn.textContent = theaterOn ? "Theater: On" : "Theater";
}

function pokeIframeResize(){
  // Helps canvas/WebGL games resize correctly inside an iframe
  try{
    if (player && player.contentWindow) {
      player.contentWindow.dispatchEvent(new Event("resize"));
    }
  }catch(e){
    // ignore cross-origin errors (external games)
  }
}

async function goFullscreen(){
  // Fullscreen the container so the top bar stays with the game
  if (!document.fullscreenElement) {
    await playerArea.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

// Keep button label updated + reflow game after fullscreen changes
document.addEventListener("fullscreenchange", () => {
  const isFs = !!document.fullscreenElement;

  // Change button text
  gameFullscreenBtn.textContent = isFs ? "Exit Fullscreen" : "Fullscreen";

  // Optional: resize local canvas games
  setTimeout(() => {
    try {
      forceCanvasCover?.(gamePlayer);
    } catch {}
  }, 120);
});

function parseHash(){
  // Examples:
  // #games
  // #settings
  // #credits
  // #game=bee-swarm
  const h = (location.hash || "#games").slice(1);

  if (h.startsWith("game=")) {
    return { route: "game", id: decodeURIComponent(h.slice(5)) };
  }
  if (h === "settings") return { route: "settings" };
  if (h === "credits") return { route: "credits" };
  return { route: "games" };
}

function goHash(route, id){
  if(route === "game") location.hash = `#game=${encodeURIComponent(id)}`;
  else location.hash = `#${route}`;
}



function openGamePage(game){
  if(!game) return;

  // show game page
  setRoute("game");

  // fill title + desc section
  gameTitle.textContent = game.name || "Game";
  gameDesc.textContent = game.desc || "WIP description.";

  // set player labels
  gamePlayerName.textContent = game.name || "—";
  gamePlayerType.textContent = (game.type === "external") ? "EXTERNAL" : "LOCAL";


  if(game.type === "external"){
    // open in new tab, and still show description page
    gamePlayer.src = "about:blank";
    window.open(game.url, "_blank", "noopener");
    gameOpenNewTab.onclick = () => window.open(game.url, "_blank", "noopener");
  } else {
    gamePlayer.src = game.path;
    gameOpenNewTab.onclick = () => window.open(game.path, "_blank", "noopener");
  }

  // scroll to top of the game page
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function toggleGameFullscreen(){
  try{
    if(!document.fullscreenElement){
      await gamePlayerArea.requestFullscreen();
    }else{
      await document.exitFullscreen();
    }
  }catch(e){
    console.error(e);
  }
}
/* ========= helpers ========= */
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function openDrawer(){
  drawer.classList.add("open");
  backdrop.classList.remove("hidden");
}
function closeDrawer(){
  drawer.classList.remove("open");
  backdrop.classList.add("hidden");
}

function setRoute(route){
  activeRoute = route;

  pageGames.classList.toggle("active", route === "games");
  pageSettings.classList.toggle("active", route === "settings");
  pageCredits.classList.toggle("active", route === "credits");
  pageGame.classList.toggle("active", route === "game");

  document.querySelectorAll(".drawerBtn[data-route]").forEach(b=>{
    b.classList.toggle("active", b.dataset.route === route);
  });

  // Search bar only on games page
  document.querySelector(".topRight").style.visibility = (route === "games") ? "visible" : "hidden";

    cleanupUI();
}

function showShell(){
  home.classList.add("hidden");
  shell.classList.remove("hidden");
  // Don't force a route here. Hash will decide.
}

function showHome(){
  shell.classList.add("hidden");
  home.classList.remove("hidden");
  closeDrawer();
  // stop any running game
  closeGameFn();
}

/* ========= game play ========= */
function closeGameFn(){
  activeGame = null;
  player.src = "about:blank";
  playerArea.classList.add("hidden");
  playerName.textContent = "—";
  playerType.textContent = "LOCAL";
}

function playGame(game){
  activeGame = game;

  if(game.type === "external"){
    playerType.textContent = "EXTERNAL";
    playerName.textContent = game.name;

    // external sites often block iframe -> open new tab
    window.open(game.url, "_blank", "noopener");
    playerArea.classList.add("hidden");

    openNewTab.onclick = () => window.open(game.url, "_blank", "noopener");
    return;
  }

  // local
  playerType.textContent = "LOCAL";
  playerName.textContent = game.name;
  playerArea.classList.remove("hidden");
applyPlayerModes();
player.src = game.path;
setTimeout(pokeIframeResize, 80);

  openNewTab.onclick = () => window.open(game.path, "_blank", "noopener");
}

/* ========= render ========= */
function tileHTML(g){
  const img = g.image || "assets/placeholder.jpg"; // you can add this placeholder later
  const chip = (g.type === "external") ? "External" : "Local";
  return `
    <div class="tile" data-id="${escapeHtml(g.id)}" role="button" tabindex="0">
      <img class="tileImg" src="${escapeHtml(img)}" alt="${escapeHtml(g.name)}" loading="lazy" />
      <div class="tileOverlay"></div>
      <div class="tileChip">${chip}</div>
      <div class="tileTitle">${escapeHtml(g.name)}</div>
    </div>
  `;
}

function render(filter=""){
  const q = filter.trim().toLowerCase();
  const list = GAMES.filter(g => {
    const hay = `${g.name} ${g.desc||""}`.toLowerCase();
    return hay.includes(q);
  });

  grid.innerHTML = list.map(tileHTML).join("");

  grid.querySelectorAll(".tile").forEach(t=>{
    const id = t.dataset.id;
    const pick = () => {
  const game = GAMES.find(x => x.id === id);
  if(game) goHash("game", game.id);
};
    t.addEventListener("click", pick);
    t.addEventListener("keydown", (e)=>{
      if(e.key === "Enter" || e.key === " ") pick();
    });
  });
}

function forceCloseUI(){
  // close drawer + backdrop no matter what
  drawer?.classList.remove("open");
  backdrop?.classList.add("hidden");

  // release pointer lock if any game grabbed it
  try { document.exitPointerLock(); } catch {}
}

if (!location.hash) goHash("games");

/* ========= load games ========= */
async function loadGames(){
  const res = await fetch("games.json", { cache:"no-store" });
  if(!res.ok) throw new Error("Could not load games.json");
  GAMES = await res.json();
  render(search.value);
}

/* ========= events ========= */
document.querySelectorAll("[data-go]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const where = btn.dataset.go;

    // show shell first
    showShell();

    // then route using HASH (so it never gets stuck on #game=...)
    if(where === "games")   goHash("games");
    if(where === "settings") goHash("settings");
    if(where === "credits")  goHash("credits");
  });
});

burger.addEventListener("click", ()=>{
  if(drawer.classList.contains("open")) closeDrawer();
  else openDrawer();
});
backdrop.addEventListener("click", closeDrawer);

backHome.addEventListener("click", showHome);
topBrand.addEventListener("click", () => {
  cleanupUI();
  goHash("games");
});
topBrand.addEventListener("keydown", (e)=>{
  if(e.key==="Enter" || e.key===" ") {
    cleanupUI();
    goHash("games");
  }
});

document.querySelectorAll(".drawerBtn[data-route]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    cleanupUI();
    goHash(btn.dataset.route); // <-- hash controls routing
  });
});

search.addEventListener("input", ()=> render(search.value));

closeGame.addEventListener("click", closeGameFn);
openNewTab.addEventListener("click", ()=>{
  if(!activeGame) return;
  if(activeGame.type === "external") window.open(activeGame.url, "_blank", "noopener");
  else window.open(activeGame.path, "_blank", "noopener");
});
fitModeBtn.addEventListener("click", () => {
  fitMode = (fitMode === "fit") ? "fill" : "fit";
  applyPlayerModes();
  setTimeout(pokeIframeResize, 50);
});

theaterBtn.addEventListener("click", () => {
  theaterOn = !theaterOn;
  applyPlayerModes();
  setTimeout(pokeIframeResize, 50);
});

fullscreenBtn.addEventListener("click", () => {
  goFullscreen().catch(console.error);
});
/* ========= init ========= */
setRoute("games");            // default internal
document.querySelector(".topRight").style.visibility = "hidden"; // only show search in games view
closeGameFn();
applyPlayerModes();
loadGames()
  .then(handleRoute)
  .catch(err => {
    console.error(err);
    grid.innerHTML = `
      <div class="wipCard">
        <div class="wipTitle">Error</div>
        <div class="wipSub">${escapeHtml(err.message)}</div>
      </div>
    `;
  });

 

gameFullscreenBtn.addEventListener("click", toggleGameFullscreen);
function handleRoute(){
  const r = parseHash();

  if(r.route === "game"){
    const g = GAMES.find(x => x.id === r.id);
    if(g) openGamePage(g);
    else setRoute("games");
    return;
  }

  setRoute(r.route);
}

window.addEventListener("hashchange", handleRoute);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[s]));
}

// Only show these when you're in an internal game view
function isInInternalGameView() {
  // Adjust this to match your app:
  // - if you use a route like "play"
  // - or you show an iframe with id="gameFrame"
  const frame = document.getElementById("gameFrame");
  const isFrameVisible = frame && frame.offsetParent !== null;
  return !!isFrameVisible; // simplest reliable check
}

function pushGameChatToast(text, username = "Chat", ms = 6000) {
  if (!isInInternalGameView()) return;

  const wrap = document.getElementById("gameChatToasts");
  if (!wrap) return;

  // cap how many are shown
  const MAX = 3;
  while (wrap.children.length >= MAX) wrap.removeChild(wrap.firstElementChild);

  const toast = document.createElement("div");
  toast.className = "game-chat-toast";

  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  toast.innerHTML = `
    <div class="meta">${escapeHtml(username)} • ${time}</div>
    <div class="msg">${escapeHtml(text)}</div>
  `;

  wrap.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, ms);
}

// pushGameChatToast(msg.text, msg.user);


/* ===== FORCE GLOBAL chat toast (debug-safe) ===== */
window.pushGameChatToast = function (text, username = "Chat", ms = 6000) {
  const wrap = document.getElementById("gameChatToasts");
  if (!wrap) {
    console.warn("Missing #gameChatToasts container");
    return;
  }

  const esc = (str) => String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[s]));

  // cap
  const MAX = 3;
  while (wrap.children.length >= MAX) wrap.removeChild(wrap.firstElementChild);

  const toast = document.createElement("div");
  toast.className = "game-chat-toast";

  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  toast.innerHTML = `
    <div class="meta">${esc(username)} • ${time}</div>
    <div class="msg">${esc(text)}</div>
  `;

  wrap.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, ms);
};

console.log("✅ pushGameChatToast attached to window");
/* =============================================== */
