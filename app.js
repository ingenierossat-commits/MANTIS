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
  const sub = document.getElementById("connStatus");
  if (snap.val() === true) {
    dot.classList.add("ok");
    sub.textContent = "sincronizado";
  } else {
    dot.classList.remove("ok");
    sub.textContent = "sin conexión…";
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

    for (let i = 0; i < 7; i++) {
      const d = addDays(cursor, i);
      const iso = dstr(d);
      const cell = document.createElement("div");
      let cls = "vac-day-cell";
      if (d.getMonth() !== viewDate.getMonth()) cls += " other-month";
      if (iso === today) cls += " today";
      cell.className = cls;

      const personas = vacacionesPorDia(iso);
      let chips = "";
      personas.forEach(p => {
        chips += `<span class="vac-chip" style="background:${VAC_COLORS[p.persona]}">${p.persona}</span>`;
      });

      cell.innerHTML = `<div class="d-num">${d.getDate()}</div><div class="vac-chips">${chips}</div>`;
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
// Conflicto vacaciones vs guardia
// ---------------------------------------------------------
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

  document.getElementById("conflictoIntro").textContent =
    `${NOMBRES[persona]} tiene guardia asignada en ${semanasConflicto.length} semana(s) que coinciden con estas vacaciones. Reasigna quién cubre:`;

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
      dbSet(`${ROOT}/guardOverrides/${btn.dataset.monday}`, btn.dataset.letter);
      btn.parentElement.parentElement.style.opacity = "0.4";
      toast(`Guardia de la semana del ${formatShort(parseISO(btn.dataset.monday))} reasignada a ${btn.dataset.letter}.`);
    };
  });

  openModal("overlayConflicto");
}

document.getElementById("btnCerrarConflicto").onclick = () => closeModal("overlayConflicto");

// ---------------------------------------------------------
// Modal: info / borrar vacaciones de un día
// ---------------------------------------------------------
function openVacInfoModal(iso, personas) {
  vacInfoDiaISO = iso;
  const list = document.getElementById("vacInfoList");
  list.innerHTML = "";
  personas.forEach(p => {
    const row = document.createElement("div");
    row.className = "vac-info-row";
    row.innerHTML = `<span><span class="dot" style="background:${VAC_COLORS[p.persona]};display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;"></span>
      ${NOMBRES[p.persona]} · ${p.inicio} → ${p.fin}</span>`;
    const delBtn = document.createElement("button");
    delBtn.className = "btn small danger";
    delBtn.textContent = "Borrar";
    delBtn.onclick = () => {
      dbRemove(`${ROOT}/vacaciones/${p.id}`);
      toast("Vacaciones eliminadas.");
      closeModal("overlayVacacionInfo");
    };
    row.appendChild(delBtn);
    list.appendChild(row);
  });
  openModal("overlayVacacionInfo");
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
