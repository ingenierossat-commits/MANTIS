/* ============================================================
   Bolsa de Horas · BF
   Firebase Realtime Database, proyecto listify-16b5d
   Nodo raíz: mantis
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyChMXx5ZcleAo5oqzPvo1K_Af_wgQkh-LQ",
  authDomain: "listify-16b5d.firebaseapp.com",
  databaseURL: "https://listify-16b5d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "listify-16b5d",
  storageBucket: "listify-16b5d.appspot.com",
  messagingSenderId: "238610923350",
  appId: "1:238610923350:web:cd5c2c3fb23b5c0afba0f7"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const ROOT = "mantis";

// ---------------------------------------------------------
// Escrituras a Firebase con aviso visible si fallan
// (reglas de la base de datos, sin conexión, etc.)
// ---------------------------------------------------------
function dbSet(path, value) {
  return db.ref(path).set(value).catch(err => toast(`⚠ Error guardando: ${err.message}`));
}
function dbRemove(path) {
  return db.ref(path).remove().catch(err => toast(`⚠ Error borrando: ${err.message}`));
}
function dbUpdate(path, obj) {
  return db.ref(path).update(obj).catch(err => toast(`⚠ Error actualizando: ${err.message}`));
}
function dbIncrementBolsa(delta) {
  return db.ref(`${ROOT}/bolsaHoras`).transaction(
    (cur) => (cur || 0) + delta,
    (err) => { if (err) toast(`⚠ Error actualizando la bolsa: ${err.message}`); }
  );
}

const LETTERS = ["B", "BF", "J", "JC"];
const NOMBRES = { B: "Bernat", BF: "Bernat Fill", J: "Jordi", JC: "Juan Carlos" };
const VAC_COLORS = { B: "#5B8DEF", BF: "#FFB020", J: "#3DDC97", JC: "#C57BFF" };
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// ---------------------------------------------------------
// Estado local (espejo de Firebase)
// ---------------------------------------------------------
let state = {
  bolsaHoras: 0,
  guardOverrides: {},
  patronGuardia: [],
  patronInicio: null,       // "YYYY-MM-DD" lunes de referencia
  horasDias: {},            // { iso: {tipo:'extra'|'descuento', horas:N} }
  miercolesCanjeados: {},
  semanasAcreditadas: {},
  vacaciones: {}            // { pushId: {persona, inicio, fin} }
};

let viewDate = new Date();
viewDate.setDate(1);
let activeTab = "guardias";

let redeemMode = { active: false, remaining: 0 };
let selectedDayISO = null;
let selectedWeekMonday = null;
let horasTipoSeleccionado = "extra";
let vacSelectedPersona = "BF";
let vacInfoDiaISO = null;

// ---------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------
function pad(n) { return n.toString().padStart(2, "0"); }
function dstr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return dstr(new Date()); }
function parseISO(s) { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); }

function mondayOf(d) {
  const m = new Date(d);
  m.setHours(0,0,0,0);
  const day = m.getDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1 - day);
  m.setDate(m.getDate() + diff);
  return m;
}

function weeksBetween(mondayA, mondayB) {
  return Math.round((mondayB - mondayA) / (7 * 86400000));
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function formatShort(d) { return `${pad(d.getDate())}/${pad(d.getMonth()+1)}`; }
function formatFull(d) { return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }

// ---------------------------------------------------------
// Firebase: escucha en tiempo real
// ---------------------------------------------------------
db.ref(".info/connected").on("value", (snap) => {
  const dot = document.getElementById("statusDot");
  if (snap.val() === true) {
    dot.classList.add("ok");
  } else {
    dot.classList.remove("ok");
  }
});

db.ref(ROOT).on("value", (snap) => {
  const v = snap.val() || {};
  state.bolsaHoras = v.bolsaHoras || 0;
  state.guardOverrides = v.guardOverrides || {};
  state.patronGuardia = v.patronGuardia || [];
  state.patronInicio = v.patronInicio || null;
  state.horasDias = v.horasDias || {};
  state.miercolesCanjeados = v.miercolesCanjeados || {};
  state.semanasAcreditadas = v.semanasAcreditadas || {};
  state.vacaciones = v.vacaciones || {};
  render();
  runAutoCredit();
});

// ---------------------------------------------------------
// Guardia: letra correspondiente a la semana (lunes dado)
// ---------------------------------------------------------
function guardLetterFor(monday) {
  const key = dstr(monday);
  if (state.guardOverrides[key]) return state.guardOverrides[key];
  if (!state.patronGuardia.length || !state.patronInicio) return "";
  const start = mondayOf(parseISO(state.patronInicio));
  const diff = weeksBetween(start, monday);
  const idx = ((diff % state.patronGuardia.length) + state.patronGuardia.length) % state.patronGuardia.length;
  return state.patronGuardia[idx];
}

// ---------------------------------------------------------
// Auto-crédito: si BF completó una semana de guardia, +8h
// ---------------------------------------------------------
function runAutoCredit() {
  if (!state.patronInicio && Object.keys(state.guardOverrides).length === 0) return;

  const today = new Date(); today.setHours(0,0,0,0);
  let start = state.patronInicio ? mondayOf(parseISO(state.patronInicio)) : null;

  const overrideKeys = Object.keys(state.guardOverrides).map(k => mondayOf(parseISO(k)));
  if (overrideKeys.length) {
    const earliestOverride = overrideKeys.reduce((a,b) => a < b ? a : b);
    if (!start || earliestOverride < start) start = earliestOverride;
  }
  if (!start) return;

  const MAX_WEEKS = 300;
  let cursor = new Date(start);
  let count = 0;

  while (cursor < today && count < MAX_WEEKS) {
    const weekEnd = addDays(cursor, 6);
    if (weekEnd < today) {
      const key = dstr(cursor);
      if (!state.semanasAcreditadas[key]) {
        const letter = guardLetterFor(cursor);
        if (letter === "BF") creditarGuardiaBF(key);
      }
    } else {
      break;
    }
    cursor = addDays(cursor, 7);
    count++;
  }
}

function creditarGuardiaBF(weekKey) {
  db.ref(`${ROOT}/semanasAcreditadas/${weekKey}`).transaction((cur) => {
    if (cur) return;
    return true;
  }, (error, committed) => {
    if (error) { toast(`⚠ Error acreditando guardia: ${error.message}`); return; }
    if (committed) {
      dbIncrementBolsa(8);
      toast(`+8h añadidas: BF completó la guardia de la semana del ${formatShort(parseISO(weekKey))}`);
    }
  });
}

// ---------------------------------------------------------
// Render principal
// ---------------------------------------------------------
function render() {
  renderStats();
  if (activeTab === "guardias") {
    renderCalendarGuardias();
  } else {
    renderCalendarVacaciones();
    renderResumenVacaciones();
    renderSolapamientos();
  }
}

function renderStats() {
  const pendientes = Object.keys(state.miercolesCanjeados).filter(k => k >= todayStr()).length;
  document.getElementById("statMiercoles").textContent = pendientes;
  document.getElementById("statHoras").innerHTML = `${state.bolsaHoras}<small>h</small>`;
}

// ---------------------------------------------------------
// Calendario: Guardias y horas
// ---------------------------------------------------------
function monthGridBounds() {
  const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const lastOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const gridStart = mondayOf(firstOfMonth);
  const lastMonday = mondayOf(lastOfMonth);
  const gridEnd = addDays(lastMonday, 6);
  return { gridStart, gridEnd };
}

function renderCalendarGuardias() {
  document.getElementById("monthTitle").textContent = `${MESES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  const body = document.getElementById("calendarBody");
  body.innerHTML = "";

  const { gridStart, gridEnd } = monthGridBounds();
  const today = todayStr();
  let cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const weekRow = document.createElement("div");
    weekRow.className = "week-row";

    const weekMonday = new Date(cursor);
    const letter = guardLetterFor(weekMonday);
    const guardBadge = document.createElement("div");
    guardBadge.className = "guard-badge" + (state.guardOverrides[dstr(weekMonday)] ? " override" : "");
    guardBadge.textContent = letter || "—";
    guardBadge.onclick = () => openGuardiaModal(weekMonday);
    weekRow.appendChild(guardBadge);

    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i);
      const iso = dstr(d);
      const cell = document.createElement("div");
      let cls = "day-cell";
      if (d.getMonth() !== viewDate.getMonth()) cls += " other-month";
      if (iso === today) cls += " today";
      if (d.getDay() === 3) cls += " wednesday";

      const isCanjeado = !!state.miercolesCanjeados[iso];
      if (isCanjeado) cls += (iso >= today) ? " canjeado" : " canjeado-pasado";
      if (redeemMode.active && d.getDay() === 3 && iso >= today && !isCanjeado) cls += " redeem-pickable";

      cell.className = cls;
      cell.innerHTML = `<div class="d-num">${d.getDate()}</div>`;
      const entry = state.horasDias[iso];
      if (entry && entry.horas) {
        const signo = entry.tipo === "descuento" ? "−" : "+";
        const color = entry.tipo === "descuento" ? "var(--red)" : "var(--teal)";
        cell.innerHTML += `<div class="hrs" style="color:${color}">${signo}${entry.horas}h</div>`;
      }

      cell.onclick = () => onDayClick(d, iso, isCanjeado);
      weekRow.appendChild(cell);
    }

    body.appendChild(weekRow);
    cursor = addDays(cursor, 7);
  }
}

// ---------------------------------------------------------
// Click en un día (vista Guardias)
// ---------------------------------------------------------
function onDayClick(dateObj, iso, isCanjeado) {
  const isWednesday = dateObj.getDay() === 3;

  if (redeemMode.active && isWednesday && iso >= todayStr() && !isCanjeado) {
    marcarCanje(iso);
    return;
  }

  if (isCanjeado) {
    if (iso >= todayStr()) openDeshacerModal(iso);
    else toast(`Miércoles ya disfrutado el ${formatShort(dateObj)}`);
    return;
  }

  openHorasModal(dateObj, iso);
}

// ---------------------------------------------------------
// Modal: horas del día (extra o asuntos propios)
// ---------------------------------------------------------
function openHorasModal(dateObj, iso) {
  selectedDayISO = iso;
  const entry = state.horasDias[iso];
  horasTipoSeleccionado = entry ? entry.tipo : "extra";
  updateTipoButtons();
  document.getElementById("diaModalSub").textContent = `Día ${formatShort(dateObj)}`;
  document.getElementById("inputHoras").value = entry ? entry.horas : "";
  document.getElementById("inputConcepto").value = entry && entry.concepto ? entry.concepto : "";
  openModal("overlayDia");
}

function updateTipoButtons() {
  document.querySelectorAll("#tipoHorasPicker .seg-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tipo === horasTipoSeleccionado);
  });
}

document.querySelectorAll("#tipoHorasPicker .seg-btn").forEach(btn => {
  btn.onclick = () => { horasTipoSeleccionado = btn.dataset.tipo; updateTipoButtons(); };
});

document.getElementById("btnGuardarHoras").onclick = () => {
  const val = parseFloat(document.getElementById("inputHoras").value);
  if (isNaN(val) || val <= 0) { toast("Introduce un número de horas válido."); return; }
  const concepto = document.getElementById("inputConcepto").value.trim();

  const anterior = state.horasDias[selectedDayISO];
  const deltaAnterior = anterior ? (anterior.tipo === "descuento" ? -anterior.horas : anterior.horas) : 0;
  const deltaNuevo = horasTipoSeleccionado === "descuento" ? -val : val;
  const delta = deltaNuevo - deltaAnterior;

  const registro = { tipo: horasTipoSeleccionado, horas: val };
  if (concepto) registro.concepto = concepto;
  dbSet(`${ROOT}/horasDias/${selectedDayISO}`, registro);
  dbIncrementBolsa(delta);

  if (horasTipoSeleccionado === "descuento" && (state.bolsaHoras + delta) < 0) {
    toast(`Guardado. Atención: la bolsa queda en negativo (${state.bolsaHoras + delta}h).`);
  } else {
    const signo = horasTipoSeleccionado === "descuento" ? "−" : "+";
    toast(`Guardado: ${signo}${val}h${concepto ? " · " + concepto : ""} el ${selectedDayISO}`);
  }
  closeModal("overlayDia");
};

document.getElementById("btnBorrarHoras").onclick = () => {
  const anterior = state.horasDias[selectedDayISO];
  if (anterior) {
    const deltaAnterior = anterior.tipo === "descuento" ? -anterior.horas : anterior.horas;
    dbRemove(`${ROOT}/horasDias/${selectedDayISO}`);
    dbIncrementBolsa(-deltaAnterior);
  }
  closeModal("overlayDia");
};

// ---------------------------------------------------------
// Modal: guardia de la semana
// ---------------------------------------------------------
function openGuardiaModal(monday) {
  selectedWeekMonday = monday;
  const sunday = addDays(monday, 6);
  document.getElementById("guardiaModalSub").textContent =
    `Semana del ${formatShort(monday)} al ${formatShort(sunday)}`;

  const current = guardLetterFor(monday);
  const hasOverride = !!state.guardOverrides[dstr(monday)];
  document.querySelectorAll("#letterPicker button").forEach(btn => {
    const isAutoBtn = btn.dataset.letter === "";
    btn.classList.toggle("active", isAutoBtn ? !hasOverride : (btn.dataset.letter === current && hasOverride));
  });
  openModal("overlayGuardia");
}

document.querySelectorAll("#letterPicker button").forEach(btn => {
  btn.onclick = () => {
    const key = dstr(selectedWeekMonday);
    if (btn.dataset.letter === "") dbRemove(`${ROOT}/guardOverrides/${key}`);
    else dbSet(`${ROOT}/guardOverrides/${key}`, btn.dataset.letter);
    closeModal("overlayGuardia");
  };
});

// ---------------------------------------------------------
// Modal: pauta cíclica de guardia
// ---------------------------------------------------------
let pautaEdit = [];

document.getElementById("btnPauta").onclick = () => {
  pautaEdit = [...state.patronGuardia];
  document.getElementById("inputPautaInicio").value = state.patronInicio || dstr(mondayOf(new Date()));
  renderPautaChips();
  openModal("overlayPauta");
};

function renderPautaChips() {
  const wrap = document.getElementById("pautaOrderChips");
  wrap.innerHTML = "";
  if (!pautaEdit.length) wrap.innerHTML = `<span class="muted">Sin pauta definida todavía.</span>`;
  pautaEdit.forEach((letter, idx) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `${idx+1}. ${letter} <button data-idx="${idx}">✕</button>`;
    chip.querySelector("button").onclick = () => { pautaEdit.splice(idx, 1); renderPautaChips(); };
    wrap.appendChild(chip);
  });
}

document.querySelectorAll("#pautaAddPicker button").forEach(btn => {
  btn.onclick = () => { pautaEdit.push(btn.dataset.letter); renderPautaChips(); };
});

document.getElementById("btnCancelarPauta").onclick = () => closeModal("overlayPauta");

document.getElementById("btnGuardarPauta").onclick = () => {
  if (!pautaEdit.length) { toast("Añade al menos una letra a la pauta."); return; }
  const inicio = document.getElementById("inputPautaInicio").value;
  if (!inicio) { toast("Elige la semana de inicio."); return; }
  const inicioLunes = dstr(mondayOf(parseISO(inicio)));
  dbSet(`${ROOT}/patronGuardia`, pautaEdit);
  dbSet(`${ROOT}/patronInicio`, inicioLunes);
  closeModal("overlayPauta");
  toast("Pauta de guardia guardada.");
};

// ---------------------------------------------------------
// Botón: conseguir miércoles
// ---------------------------------------------------------
let pendingRedeemCount = 0;

document.getElementById("btnConseguir").onclick = () => {
  const disponibles = Math.floor(state.bolsaHoras / 8);
  const sobran = state.bolsaHoras % 8;

  if (disponibles < 1) {
    toast(`Aún no llegas a 8h en la bolsa. Bolsa actual: ${state.bolsaHoras}h.`);
    return;
  }

  document.getElementById("canjeModalSub").textContent =
    `Puedes canjear ${disponibles} miércoles${disponibles > 1 ? "s" : ""}. ` +
    `Tras el canje quedarán ${sobran}h en la bolsa.`;
  pendingRedeemCount = disponibles;
  openModal("overlayCanje");
};

document.getElementById("btnCanjeNo").onclick = () => closeModal("overlayCanje");

document.getElementById("btnCanjeSi").onclick = () => {
  closeModal("overlayCanje");
  redeemMode.active = true;
  redeemMode.remaining = pendingRedeemCount;
  updateRedeemBanner();
  render();
};

function updateRedeemBanner() {
  const banner = document.getElementById("redeemBanner");
  if (redeemMode.active && redeemMode.remaining > 0) {
    banner.style.display = "flex";
    document.getElementById("redeemBannerText").textContent =
      `Toca en el calendario los miércoles a canjear · quedan ${redeemMode.remaining}`;
  } else {
    banner.style.display = "none";
    redeemMode.active = false;
  }
}

document.getElementById("btnCancelarCanje").onclick = () => {
  redeemMode.active = false;
  redeemMode.remaining = 0;
  updateRedeemBanner();
  render();
};

function marcarCanje(iso) {
  dbSet(`${ROOT}/miercolesCanjeados/${iso}`, true);
  dbIncrementBolsa(-8);
  redeemMode.remaining -= 1;
  toast(`Miércoles ${iso} marcado como canjeado.`);
  updateRedeemBanner();
  render();
}

// ---------------------------------------------------------
// Modal: deshacer canje
// ---------------------------------------------------------
let deshacerISO = null;

function openDeshacerModal(iso) {
  deshacerISO = iso;
  document.getElementById("deshacerSub").textContent =
    `¿Deshacer el canje del miércoles ${iso}? Se devolverán 8h a la bolsa.`;
  openModal("overlayDeshacer");
}

document.getElementById("btnDeshacerNo").onclick = () => closeModal("overlayDeshacer");
document.getElementById("btnDeshacerSi").onclick = () => {
  dbRemove(`${ROOT}/miercolesCanjeados/${deshacerISO}`);
  dbIncrementBolsa(8);
  closeModal("overlayDeshacer");
  toast("Canje deshecho, +8h devueltas a la bolsa.");
};

// ---------------------------------------------------------
// Pestañas Guardias / Vacaciones
// ---------------------------------------------------------
document.getElementById("tabGuardias").onclick = () => switchTab("guardias");
document.getElementById("tabVacaciones").onclick = () => switchTab("vacaciones");

function switchTab(tab) {
  activeTab = tab;
  document.getElementById("tabGuardias").classList.toggle("active", tab === "guardias");
  document.getElementById("tabVacaciones").classList.toggle("active", tab === "vacaciones");
  document.getElementById("viewGuardias").style.display = tab === "guardias" ? "block" : "none";
  document.getElementById("viewVacaciones").style.display = tab === "vacaciones" ? "block" : "none";
  document.getElementById("resumenVacacionesCard").style.display = tab === "vacaciones" ? "block" : "none";
  document.getElementById("solapamientosCard").style.display = tab === "vacaciones" ? "block" : "none";
  render();
}

// ---------------------------------------------------------
// Calendario: Vacaciones
// ---------------------------------------------------------
function vacacionesPorDia(iso) {
  const d = parseISO(iso);
  const resultado = [];
  Object.entries(state.vacaciones).forEach(([id, v]) => {
    if (iso >= v.inicio && iso <= v.fin) resultado.push({ id, ...v });
  });
  return resultado;
}

function renderCalendarVacaciones() {
  document.getElementById("monthTitle").textContent = `${MESES[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  const body = document.getElementById("vacCalendarBody");
  body.innerHTML = "";

  const { gridStart, gridEnd } = monthGridBounds();
  const today = todayStr();
  let cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    const weekRow = document.createElement("div");
    weekRow.className = "vac-week-row";

    const weekMonday = new Date(cursor);
    const letter = guardLetterFor(weekMonday);
    const guardBadge = document.createElement("div");
    guardBadge.className = "guard-badge" + (state.guardOverrides[dstr(weekMonday)] ? " override" : "");
    guardBadge.textContent = letter || "—";
    guardBadge.onclick = () => openGuardiaModal(weekMonday);
    weekRow.appendChild(guardBadge);

    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i);
      const iso = dstr(d);
      const cell = document.createElement("div");
      let cls = "vac-day-cell";
      if (d.getMonth() !== viewDate.getMonth()) cls += " other-month";
      if (iso === today) cls += " today";

      const personas = vacacionesPorDia(iso);
      let bgStyle = "";
      if (personas.length === 1) {
        cls += " vac-filled";
        bgStyle = `background:${VAC_COLORS[personas[0].persona]};`;
      } else if (personas.length > 1) {
        cls += " vac-filled";
        const n = personas.length;
        const segs = personas.map((p, idx) =>
          `${VAC_COLORS[p.persona]} ${Math.round(idx*100/n)}% ${Math.round((idx+1)*100/n)}%`
        );
        bgStyle = `background:linear-gradient(90deg, ${segs.join(",")});`;
      }
      if (personas.length >= 2) cls += " overlap-warn";

      cell.className = cls;
      if (bgStyle) cell.setAttribute("style", bgStyle);
      cell.innerHTML = `<div class="d-num">${d.getDate()}</div>`;
      cell.onclick = () => onVacDayClick(d, iso, personas);
      weekRow.appendChild(cell);
    }

    body.appendChild(weekRow);
    cursor = addDays(cursor, 7);
  }

  const legend = document.getElementById("vacLegend");
  legend.innerHTML = LETTERS.map(l =>
    `<span><span class="dot" style="background:${VAC_COLORS[l]}"></span>${NOMBRES[l]}</span>`
  ).join("");
}

function onVacDayClick(dateObj, iso, personas) {
  if (personas.length) {
    openVacInfoModal(iso, personas);
  } else {
    openVacacionModal(iso);
  }
}

// ---------------------------------------------------------
// Modal: asignar vacaciones
// ---------------------------------------------------------
document.getElementById("btnAsignarVacaciones").onclick = () => openVacacionModal(todayStr());

function openVacacionModal(isoInicio) {
  document.getElementById("inputVacInicio").value = isoInicio;
  document.getElementById("inputVacFin").value = isoInicio;
  updateVacPersonaButtons();
  openModal("overlayVacacion");
}

document.querySelectorAll("#vacPersonaPicker button[data-letter]").forEach(btn => {
  btn.onclick = () => { vacSelectedPersona = btn.dataset.letter; updateVacPersonaButtons(); };
});

function updateVacPersonaButtons() {
  document.querySelectorAll("#vacPersonaPicker button[data-letter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.letter === vacSelectedPersona);
  });
}

document.getElementById("btnCancelarVacacion").onclick = () => closeModal("overlayVacacion");

document.getElementById("btnGuardarVacacion").onclick = () => {
  const inicio = document.getElementById("inputVacInicio").value;
  const fin = document.getElementById("inputVacFin").value;
  if (!inicio || !fin) { toast("Elige fecha de inicio y fin."); return; }
  if (fin < inicio) { toast("La fecha de fin no puede ser anterior al inicio."); return; }

  const nuevoId = db.ref(`${ROOT}/vacaciones`).push().key;
  dbSet(`${ROOT}/vacaciones/${nuevoId}`, { persona: vacSelectedPersona, inicio, fin });
  closeModal("overlayVacacion");
  toast(`Vacaciones de ${NOMBRES[vacSelectedPersona]} guardadas: ${inicio} → ${fin}`);

  comprobarConflictoGuardia(vacSelectedPersona, inicio, fin);
};

// ---------------------------------------------------------
// Conflicto vacaciones vs guardia (con permuta)
// ---------------------------------------------------------
let permutaUsedWeeks = new Set();
let permutaContext = null;

function comprobarConflictoGuardia(persona, inicio, fin) {
  const start = parseISO(inicio);
  const end = parseISO(fin);
  const semanasConflicto = [];
  let cursor = mondayOf(start);
  const finMonday = mondayOf(end);

  while (cursor <= finMonday) {
    const letter = guardLetterFor(cursor);
    if (letter === persona) semanasConflicto.push(new Date(cursor));
    cursor = addDays(cursor, 7);
  }

  if (!semanasConflicto.length) return;

  permutaUsedWeeks = new Set();

  document.getElementById("conflictoIntro").textContent =
    `${NOMBRES[persona]} tiene guardia asignada en ${semanasConflicto.length} semana(s) que coinciden con estas vacaciones. ` +
    `Elige quién la cubre; luego te dejo elegir a cambio qué semana de esa persona pasa a ${NOMBRES[persona]}.`;

  const list = document.getElementById("conflictoList");
  list.innerHTML = "";
  semanasConflicto.forEach(monday => {
    const row = document.createElement("div");
    row.className = "conflicto-row";
    const sunday = addDays(monday, 6);
    const otras = LETTERS.filter(l => l !== persona);
    row.innerHTML = `<span>Semana ${formatShort(monday)}–${formatShort(sunday)}</span>
      <span class="mini-picker">${otras.map(l => `<button data-letter="${l}" data-monday="${dstr(monday)}">${l}</button>`).join("")}</span>`;
    list.appendChild(row);
  });

  list.querySelectorAll("button[data-letter]").forEach(btn => {
    btn.onclick = () => {
      abrirPermuta(persona, btn.dataset.monday, btn.dataset.letter, btn.parentElement.parentElement);
    };
  });

  openModal("overlayConflicto");
}

document.getElementById("btnCerrarConflicto").onclick = () => closeModal("overlayConflicto");

function abrirPermuta(personaOriginal, weekKeyConflicto, letraSustituta, rowEl) {
  const conflictoMonday = parseISO(weekKeyConflicto);
  const hoyMonday = mondayOf(new Date());
  const desde = hoyMonday > conflictoMonday ? hoyMonday : conflictoMonday;

  const candidatas = [];
  let cursor = addDays(desde, 7);
  let iter = 0;
  while (candidatas.length < 4 && iter < 104) {
    const key = dstr(cursor);
    if (key !== weekKeyConflicto && !permutaUsedWeeks.has(key) && guardLetterFor(cursor) === letraSustituta) {
      candidatas.push(new Date(cursor));
    }
    cursor = addDays(cursor, 7);
    iter++;
  }

  permutaContext = { personaOriginal, weekKeyConflicto, letraSustituta, rowEl };

  const body = document.getElementById("permutaBody");
  body.innerHTML = "";

  if (!candidatas.length) {
    const aviso = document.createElement("div");
    aviso.className = "muted";
    aviso.textContent = `${NOMBRES[letraSustituta]} no tiene guardias próximas en la pauta actual para hacer el cambio.`;
    body.appendChild(aviso);

    const btnSinPermuta = document.createElement("button");
    btnSinPermuta.className = "btn ghost";
    btnSinPermuta.style.width = "100%";
    btnSinPermuta.style.marginTop = "10px";
    btnSinPermuta.textContent = `Asignar a ${letraSustituta} sin permuta`;
    btnSinPermuta.onclick = () => {
      dbSet(`${ROOT}/guardOverrides/${weekKeyConflicto}`, letraSustituta);
      toast(`Semana del ${formatShort(conflictoMonday)} reasignada a ${letraSustituta}, sin cambio a cambio.`);
      if (rowEl) rowEl.style.opacity = "0.4";
      closeModal("overlayPermuta");
    };
    body.appendChild(btnSinPermuta);
  } else {
    const intro = document.createElement("div");
    intro.className = "muted";
    intro.textContent =
      `${NOMBRES[letraSustituta]} cubre la guardia de ${NOMBRES[personaOriginal]} del ${formatShort(conflictoMonday)}. ` +
      `A cambio, ¿qué semana de ${NOMBRES[letraSustituta]} pasa a ${NOMBRES[personaOriginal]}?`;
    body.appendChild(intro);

    candidatas.forEach(monday => {
      const sunday = addDays(monday, 6);
      const btn = document.createElement("button");
      btn.className = "btn ghost";
      btn.style.width = "100%";
      btn.style.marginBottom = "8px";
      btn.textContent = `Semana ${formatShort(monday)} – ${formatShort(sunday)}`;
      btn.onclick = () => confirmarPermuta(monday);
      body.appendChild(btn);
    });
  }

  openModal("overlayPermuta");
}

function confirmarPermuta(monday) {
  const { personaOriginal, weekKeyConflicto, letraSustituta, rowEl } = permutaContext;
  const key = dstr(monday);

  dbSet(`${ROOT}/guardOverrides/${weekKeyConflicto}`, letraSustituta);
  dbSet(`${ROOT}/guardOverrides/${key}`, personaOriginal);
  permutaUsedWeeks.add(key);

  toast(`Permuta hecha: ${letraSustituta} cubre el ${formatShort(parseISO(weekKeyConflicto))} · ${NOMBRES[personaOriginal]} cubrirá el ${formatShort(monday)}.`);
  if (rowEl) rowEl.style.opacity = "0.4";
  closeModal("overlayPermuta");
}

document.getElementById("btnCerrarPermuta").onclick = () => closeModal("overlayPermuta");

// ---------------------------------------------------------
// Modal: info / quitar vacaciones de un día
// ---------------------------------------------------------
let vacInfoPersonas = [];
let vacInfoSelectedPersona = null;

function openVacInfoModal(iso, personas) {
  vacInfoDiaISO = iso;
  vacInfoPersonas = personas;
  vacInfoSelectedPersona = personas.length === 1 ? personas[0].persona : null;
  renderVacInfoStep();
  openModal("overlayVacacionInfo");
}

function renderVacInfoStep() {
  const list = document.getElementById("vacInfoList");
  list.innerHTML = "";

  if (!vacInfoSelectedPersona) {
    const intro = document.createElement("div");
    intro.className = "muted";
    intro.textContent = "Este día tiene vacaciones de varias personas. ¿De quién quieres hacer el cambio?";
    list.appendChild(intro);

    const picker = document.createElement("div");
    picker.className = "letter-picker";
    picker.style.gridTemplateColumns = `repeat(${vacInfoPersonas.length}, 1fr)`;
    vacInfoPersonas.forEach(p => {
      const btn = document.createElement("button");
      btn.textContent = p.persona;
      btn.style.background = VAC_COLORS[p.persona];
      btn.style.color = "#14171A";
      btn.style.borderColor = "#000";
      btn.onclick = () => { vacInfoSelectedPersona = p.persona; renderVacInfoStep(); };
      picker.appendChild(btn);
    });
    list.appendChild(picker);
    return;
  }

  const entry = vacInfoPersonas.find(p => p.persona === vacInfoSelectedPersona);
  const row = document.createElement("div");
  row.className = "vac-info-row";
  row.innerHTML = `<span><span class="dot" style="background:${VAC_COLORS[entry.persona]};display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;"></span>
    ${NOMBRES[entry.persona]} · ${entry.inicio} → ${entry.fin}</span>`;
  list.appendChild(row);

  const rowBtns = document.createElement("div");
  rowBtns.className = "row-btns";
  rowBtns.style.marginTop = "10px";

  const btnSoloDia = document.createElement("button");
  btnSoloDia.className = "btn ghost";
  btnSoloDia.textContent = `Quitar solo el ${formatShort(parseISO(vacInfoDiaISO))}`;
  btnSoloDia.onclick = () => {
    quitarUnDiaVacacion(entry.id, vacInfoDiaISO);
    closeModal("overlayVacacionInfo");
  };

  const btnTodo = document.createElement("button");
  btnTodo.className = "btn danger";
  btnTodo.textContent = "Quitar toda la selección";
  btnTodo.onclick = () => {
    dbRemove(`${ROOT}/vacaciones/${entry.id}`);
    toast("Selección de vacaciones eliminada.");
    closeModal("overlayVacacionInfo");
  };

  rowBtns.appendChild(btnSoloDia);
  rowBtns.appendChild(btnTodo);
  list.appendChild(rowBtns);

  if (vacInfoPersonas.length > 1) {
    const back = document.createElement("button");
    back.className = "btn ghost small";
    back.style.marginTop = "8px";
    back.style.width = "100%";
    back.textContent = "‹ Elegir otra persona";
    back.onclick = () => { vacInfoSelectedPersona = null; renderVacInfoStep(); };
    list.appendChild(back);
  }
}

function quitarUnDiaVacacion(rangeId, iso) {
  const entry = state.vacaciones[rangeId];
  if (!entry) return;

  if (entry.inicio === entry.fin) {
    dbRemove(`${ROOT}/vacaciones/${rangeId}`);
    toast("Día de vacaciones eliminado.");
  } else if (iso === entry.inicio) {
    dbUpdate(`${ROOT}/vacaciones/${rangeId}`, { inicio: dstr(addDays(parseISO(iso), 1)) });
    toast("Día eliminado del inicio del rango.");
  } else if (iso === entry.fin) {
    dbUpdate(`${ROOT}/vacaciones/${rangeId}`, { fin: dstr(addDays(parseISO(iso), -1)) });
    toast("Día eliminado del final del rango.");
  } else {
    dbUpdate(`${ROOT}/vacaciones/${rangeId}`, { fin: dstr(addDays(parseISO(iso), -1)) });
    const nuevoId = db.ref(`${ROOT}/vacaciones`).push().key;
    dbSet(`${ROOT}/vacaciones/${nuevoId}`, { persona: entry.persona, inicio: dstr(addDays(parseISO(iso), 1)), fin: entry.fin });
    toast("Día eliminado; el rango se ha dividido en dos.");
  }
}

document.getElementById("btnCerrarVacInfo").onclick = () => closeModal("overlayVacacionInfo");

// ---------------------------------------------------------
// Resumen de vacaciones tomadas este año
// ---------------------------------------------------------
function renderResumenVacaciones() {
  const anioActual = new Date().getFullYear();
  const hoy = todayStr();
  const totales = { B: 0, BF: 0, J: 0, JC: 0 };

  Object.values(state.vacaciones).forEach(v => {
    let d = parseISO(v.inicio);
    const fin = parseISO(v.fin);
    while (d <= fin) {
      const iso = dstr(d);
      if (d.getFullYear() === anioActual && iso <= hoy) {
        totales[v.persona] = (totales[v.persona] || 0) + 1;
      }
      d = addDays(d, 1);
    }
  });

  const wrap = document.getElementById("resumenVacaciones");
  wrap.innerHTML = LETTERS.map(l => `
    <div class="resumen-row">
      <span class="name-chip"><span class="sw" style="background:${VAC_COLORS[l]}"></span>${NOMBRES[l]}</span>
      <span class="days">${totales[l]} día${totales[l] === 1 ? "" : "s"}</span>
    </div>
  `).join("");
}

// ---------------------------------------------------------
// Aviso: días con dos o más personas de vacaciones a la vez
// ---------------------------------------------------------
function calcularSolapamientos() {
  const entries = Object.values(state.vacaciones);
  if (!entries.length) return [];

  let minDate = null, maxDate = null;
  entries.forEach(v => {
    const i = parseISO(v.inicio), f = parseISO(v.fin);
    if (!minDate || i < minDate) minDate = i;
    if (!maxDate || f > maxDate) maxDate = f;
  });

  const rangos = [];
  let actual = null;
  let cursor = new Date(minDate);
  let iter = 0;

  while (cursor <= maxDate && iter < 3000) {
    const iso = dstr(cursor);
    const personas = vacacionesPorDia(iso);
    if (personas.length >= 2) {
      if (!actual) {
        actual = { inicio: iso, fin: iso, maxOverlap: personas.length, personasSet: new Set(personas.map(p => p.persona)) };
      } else {
        actual.fin = iso;
        actual.maxOverlap = Math.max(actual.maxOverlap, personas.length);
        personas.forEach(p => actual.personasSet.add(p.persona));
      }
    } else if (actual) {
      rangos.push(actual);
      actual = null;
    }
    cursor = addDays(cursor, 1);
    iter++;
  }
  if (actual) rangos.push(actual);

  return rangos;
}

function renderSolapamientos() {
  const rangos = calcularSolapamientos();
  const list = document.getElementById("solapamientosList");
  const vacio = document.getElementById("solapamientosVacio");
  list.innerHTML = "";

  if (!rangos.length) {
    vacio.style.display = "block";
    return;
  }
  vacio.style.display = "none";

  rangos.forEach(r => {
    const activos = LETTERS.length - r.maxOverlap;
    const inicioD = parseISO(r.inicio);
    const finD = parseISO(r.fin);
    const rangoTxt = r.inicio === r.fin ? formatFull(inicioD) : `${formatFull(inicioD)} → ${formatFull(finD)}`;
    const nombres = [...r.personasSet].map(l => NOMBRES[l]).join(", ");

    const row = document.createElement("div");
    row.className = "solap-row";
    row.innerHTML = `
      <span class="warn-icon">⚠</span>
      <span class="solap-text">
        <span class="solap-fechas">${rangoTxt}</span> · quedan ${activos} operario${activos === 1 ? "" : "s"} activo${activos === 1 ? "" : "s"}
        <span class="solap-detalle">De vacaciones en algún momento del rango: ${nombres}</span>
      </span>`;
    list.appendChild(row);
  });
}

// ---------------------------------------------------------
// Navegación de mes
// ---------------------------------------------------------
document.getElementById("btnPrevMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth() - 1); render(); };
document.getElementById("btnNextMonth").onclick = () => { viewDate.setMonth(viewDate.getMonth() + 1); render(); };

// ---------------------------------------------------------
// Modales genéricos + toast
// ---------------------------------------------------------
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

document.querySelectorAll(".overlay").forEach(ov => {
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
});

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
