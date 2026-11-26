"use strict";

const state = {
  token: sessionStorage.getItem("medcore.access") || "",
  user: JSON.parse(sessionStorage.getItem("medcore.user") || "null"),
  page: "dashboard",
  hospitalId: sessionStorage.getItem("medcore.hospital") || "",
};

const ROLES = {
  super_admin: "Super administrator", hospital_admin: "Hospital administrator", doctor: "Doctor",
  nurse: "Nurse", receptionist: "Receptionist", lab_technician: "Lab technician",
  pharmacist: "Pharmacist", accountant: "Accountant", patient: "Patient",
};
const NAV = [
  ["dashboard", "Overview", "◫", ["*"]],
  ["appointments", "Appointments", "▦", ["super_admin", "hospital_admin", "doctor", "nurse", "receptionist", "patient"]],
  ["clinical", "Clinical care", "✚", ["super_admin", "hospital_admin", "doctor", "nurse", "patient"]],
  ["labs", "Laboratory", "⌕", ["super_admin", "hospital_admin", "doctor", "patient", "lab_technician"]],
  ["pharmacy", "Pharmacy", "▤", ["super_admin", "hospital_admin", "doctor", "pharmacist"]],
  ["billing", "Billing", "₹", ["super_admin", "hospital_admin", "receptionist", "accountant", "patient"]],
  ["team", "Hospital setup", "⌂", ["super_admin", "hospital_admin"]],
  ["notifications", "Notifications", "♧", ["*"]],
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[ch]));
const titleCase = value => String(value || "").replaceAll("_", " ").replace(/\b\w/g, m => m.toUpperCase());
const roleLabel = role => ROLES[role] || titleCase(role);
const currency = (amount, code = "INR") => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(Number(amount)); }
  catch { return `${code} ${amount}`; }
};
const dateLabel = value => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const clean = value => String(value || "").trim();

function toast(message, isError = false) {
  const box = $("#toast");
  box.textContent = message;
  box.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { box.className = "toast"; }, 3200);
}

async function refreshAccessToken() {
  try {
    const response = await fetch("/auth/refresh", { method: "POST", credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok || !body.success) return false;
    state.token = body.data.accessToken;
    sessionStorage.setItem("medcore.access", state.token);
    return true;
  } catch { return false; }
}

function scopedPath(path, method = "GET") {
  if (method !== "GET" || state.user?.role !== "super_admin" || !state.hospitalId) return path;
  const url = new URL(path, location.origin);
  if (!url.pathname.startsWith("/hospitals") && !url.searchParams.has("hospital_id")) {
    url.searchParams.set("hospital_id", state.hospitalId);
  }
  return `${url.pathname}${url.search}`;
}

async function api(path, options = {}, retried = false) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(scopedPath(path, method), {
      method, headers, body, credentials: "same-origin",
    });
  } catch {
    throw new Error("Could not reach MedCore. Check that the local server is running.");
  }
  if (response.status === 401 && !retried && await refreshAccessToken()) {
    return api(path, options, true);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const error = result.error?.message || `Request failed (${response.status})`;
    if (response.status === 401 && !retried) signOut(false);
    throw new Error(error);
  }
  return result.data;
}

function showSignIn(email = "") {
  $("#appView").hidden = true;
  $("#authView").hidden = false;
  $("#authView").innerHTML = `
    <section class="auth-brand-panel">
      <a class="brand" href="#"><span class="brand-mark">M</span><span><strong>MedCore</strong><small>Hospital care, connected</small></span></a>
      <div class="auth-hero">
        <p class="eyebrow" style="color:#7fe0c1">CARE OPERATIONS</p>
        <h1>Better care begins with a clearer picture.</h1>
        <p>One secure workspace for appointments, clinical notes, pharmacy, laboratory, and billing.</p>
        <div class="auth-points"><span>Role-based hospital workflows</span><span>Patient care records in one place</span><span>Live inventory and billing overview</span></div>
      </div>
      <small style="color:#afc5d0">MedCore HMS · Academic project demo</small>
    </section>
    <section class="auth-side"><div class="auth-card">
      <p class="eyebrow">WELCOME BACK</p><h2>Sign in to MedCore</h2><p>Use the account created for your hospital.</p>
      <form data-form="login">
        <div class="field"><label for="loginEmail">Email address</label><input id="loginEmail" name="email" type="email" autocomplete="username" value="${escapeHtml(email)}" required></div>
        <div class="field"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div>
        <button class="button" type="submit">Sign in</button>
      </form>
      <p class="auth-foot">New patient? <button class="text-button" type="button" data-action="show-register">Create an account</button></p>
      <div class="auth-helper">For a new local setup, create and verify a hospital with the seeded super administrator first. Change default credentials before public deployment.</div>
    </div></section>`;
}

function showRegister() {
  $("#authView").innerHTML = `
    <section class="auth-brand-panel">
      <a class="brand" href="#"><span class="brand-mark">M</span><span><strong>MedCore</strong><small>Hospital care, connected</small></span></a>
      <div class="auth-hero"><p class="eyebrow" style="color:#7fe0c1">PATIENT ACCESS</p><h1>Your care, organized in one place.</h1><p>Join a verified hospital to book appointments and review your care information.</p><div class="auth-points"><span>Private patient account</span><span>Appointment and bill overview</span><span>Care updates and notifications</span></div></div>
      <small style="color:#afc5d0">MedCore HMS · Academic project demo</small>
    </section>
    <section class="auth-side"><div class="auth-card"><p class="eyebrow">PATIENT REGISTRATION</p><h2>Create an account</h2><p>Ask your hospital for its registration code.</p>
      <form data-form="register">
        <div class="field"><label>Full name</label><input name="name" autocomplete="name" required></div>
        <div class="field"><label>Email address</label><input name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div>
        <div class="field"><label>Phone (optional)</label><input name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label>Hospital registration code</label><input name="hospital_code" maxlength="20" required></div>
        <button class="button" type="submit">Register</button>
      </form>
      <p class="auth-foot">Already registered? <button class="text-button" type="button" data-action="show-login">Sign in</button></p>
    </div></section>`;
}

function showVerify(email, demoCode = "") {
  $("#authView").innerHTML = `
    <section class="auth-brand-panel"><a class="brand" href="#"><span class="brand-mark">M</span><span><strong>MedCore</strong><small>Hospital care, connected</small></span></a>
      <div class="auth-hero"><p class="eyebrow" style="color:#7fe0c1">ONE MORE STEP</p><h1>Verify your email.</h1><p>Enter the code sent to your email address to activate your patient account.</p></div><small style="color:#afc5d0">MedCore HMS · Academic project demo</small>
    </section><section class="auth-side"><div class="auth-card"><p class="eyebrow">EMAIL VERIFICATION</p><h2>Check your inbox</h2><p>We sent a verification code to <strong>${escapeHtml(email)}</strong>.</p>
      <form data-form="verify" data-email="${escapeHtml(email)}"><div class="field"><label>Six-digit code</label><input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" value="${escapeHtml(demoCode)}" autocomplete="one-time-code" required></div><button class="button" type="submit">Verify email</button></form>
      <div class="auth-helper">${demoCode ? "Local demo code is filled in. Verify to continue." : "Email delivery is not connected in this demo. Set up a real email provider to deliver production verification codes."}</div>
      <p class="auth-foot"><button class="text-button" type="button" data-action="show-login">Back to sign in</button></p>
    </div></section>`;
}

function visibleNav() {
  return NAV.filter(([, , , roles]) => roles.includes("*") || roles.includes(state.user?.role));
}

function showApplication() {
  $("#authView").hidden = true;
  $("#appView").hidden = false;
  $("#accountName").textContent = state.user?.name || "MedCore user";
  $("#accountRole").textContent = roleLabel(state.user?.role);
  $("#accountAvatar").textContent = (state.user?.name || "M").trim().charAt(0).toUpperCase();
  $("#mainNav").innerHTML = visibleNav().map(([id, label, icon]) =>
    `<button type="button" class="nav-link ${state.page === id ? "active" : ""}" data-page="${id}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></button>`
  ).join("");
  renderPage();
}

function pageIntro(title, description, action = "") {
  return `<div class="intro-row"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`;
}

function panel(title, body, subtitle = "") {
  return `<section class="panel"><div class="panel-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div></div>${body}</section>`;
}

function empty(title, description = "There is nothing to show yet.") {
  return `<div class="empty"><strong>${title}</strong>${description}</div>`;
}

function badge(status) {
  const tone = ["paid", "approved", "completed", "confirmed", "in_progress"].includes(status) ? "good"
    : ["failed", "cancelled", "unpaid"].includes(status) ? "bad"
      : ["pending", "ordered", "result_ready"].includes(status) ? "warn" : "";
  return `<span class="badge ${tone}">${escapeHtml(titleCase(status))}</span>`;
}

function listCards(rows, render, message = "No records yet") {
  return rows.length ? `<div class="list">${rows.map(render).join("")}</div>` : empty(message, "Records will appear here when the workflow starts.");
}

function table(headers, rows) {
  if (!rows.length) return empty("No records found");
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function can(action) {
  const role = state.user?.role;
  const rights = {
    book: ["patient", "hospital_admin", "receptionist"],
    manageAppointment: ["hospital_admin", "receptionist"],
    doctor: ["doctor"], admin: ["hospital_admin"],
    billing: ["super_admin", "hospital_admin", "receptionist", "accountant"],
    inventory: ["hospital_admin", "pharmacist"], dispense: ["pharmacist"],
  };
  return rights[action]?.includes(role) || false;
}

async function safeList(path) {
  try { return await api(path) || []; }
  catch { return []; }
}

async function renderPage() {
  const page = state.page;
  const labels = Object.fromEntries(NAV.map(([id, label]) => [id, label]));
  $("#pageTitle").textContent = labels[page] || "Overview";
  const content = $("#pageContent");
  content.innerHTML = `<section class="panel">${empty("Loading", "Connecting to your hospital workspace…")}</section>`;
  try {
    const renderer = {
      dashboard: renderDashboard, appointments: renderAppointments, clinical: renderClinical,
      labs: renderLabs, pharmacy: renderPharmacy, billing: renderBilling,
      team: renderTeam, notifications: renderNotifications,
    }[page] || renderDashboard;
    content.innerHTML = await renderer();
  } catch (error) {
    content.innerHTML = `<div class="notice warn">${escapeHtml(error.message)}</div>`;
  }
}

async function renderDashboard() {
  const banner = state.user.role === "super_admin" && !state.hospitalId
    ? `<div class="notice warn" style="margin-bottom:16px">Choose a hospital in <strong>Hospital setup</strong> to view its operational dashboard.</div>` : "";
  const appointmentRoles = NAV.find(([id]) => id === "appointments")[3];
  const billRoles = ["super_admin", "hospital_admin", "receptionist", "accountant", "patient"];
  const labRoles = ["super_admin", "hospital_admin", "doctor", "patient", "lab_technician"];
  const inventoryRoles = ["super_admin", "hospital_admin", "doctor", "pharmacist"];
  const canSeeAppointments = appointmentRoles.includes(state.user.role);
  const [appointments, bills, labs, medicines] = await Promise.all([
    canSeeAppointments ? safeList("/appointments?limit=100") : Promise.resolve([]),
    billRoles.includes(state.user.role) ? safeList("/bills?limit=100") : Promise.resolve([]),
    labRoles.includes(state.user.role) ? safeList("/lab-orders?limit=100") : Promise.resolve([]),
    inventoryRoles.includes(state.user.role) ? safeList("/medicines") : Promise.resolve([]),
  ]);
  const paid = bills.filter(row => row.status === "paid").length;
  const open = bills.filter(row => row.status === "unpaid").length;
  const pendingLabs = labs.filter(row => row.status !== "approved").length;
  const statuses = ["pending", "confirmed", "in_progress", "completed", "cancelled"];
  const counts = statuses.map(status => [status, appointments.filter(a => a.status === status).length]);
  const max = Math.max(1, ...counts.map(x => x[1]));
  const chart = counts.map(([status, count]) => `<div class="chart-row"><span>${escapeHtml(titleCase(status))}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.max(count ? 5 : 0, count / max * 100)}%"></div></div><span class="chart-count">${count}</span></div>`).join("");
  const stats = [];
  if (canSeeAppointments) stats.push(["Appointments", appointments.length, "▦", "Recent records"]);
  if (billRoles.includes(state.user.role)) stats.push(["Unpaid bills", open, "₹", `${paid} paid`]);
  if (labRoles.includes(state.user.role)) stats.push(["Lab reviews", pendingLabs, "⌕", `${labs.length} lab orders`]);
  if (inventoryRoles.includes(state.user.role)) stats.push(["Medicines", medicines.length, "▤", `${medicines.filter(m => m.lowStock).length} low stock`]);
  const cards = stats.map(([label, value, icon, note]) => `<article class="stat-card"><div class="stat-label"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`).join("");
  const chartPanel = canSeeAppointments
    ? `<section class="panel"><div class="panel-heading"><div><h2>Appointment activity</h2><p>Recent appointments by status</p></div></div><div class="chart">${chart}</div></section>`
    : `<section class="panel"><div class="panel-heading"><div><h2>Your workspace</h2><p>Available tools for your role</p></div></div>${empty("Role-scoped access", "Only areas your account can access are shown here.")}</section>`;
  const quickActions = visibleNav().filter(([id]) => !["dashboard", "notifications"].includes(id))
    .slice(0, 4).map(([id, label]) => `<button class="button button-outline" data-page="${id}">${escapeHtml(label)}</button>`).join("");
  return `${pageIntro(`Welcome, ${escapeHtml(state.user.name.split(" ")[0])}`, "Here is the latest activity across your care workspace.")}${banner}<div class="grid grid-4 stats-grid">${cards}</div><div class="grid grid-2">${chartPanel}<section class="panel"><div class="panel-heading"><div><h2>Quick actions</h2><p>Continue with a common workflow</p></div></div><div class="role-tabs">${quickActions}<button class="button button-outline" data-page="notifications">My notifications</button></div><div class="divider"></div><p class="form-note">Information is limited by your role and hospital access.</p></section></div>`;
}

async function renderAppointments() {
  const rows = await safeList("/appointments?limit=100");
  const managesAvailability = ["hospital_admin", "doctor"].includes(state.user.role);
  const doctors = can("book") || state.user.role === "hospital_admin" ? await safeList("/doctors") : [];
  const options = doctors.map(d => `<option value="${d.id}">${escapeHtml(d.name)} · ${escapeHtml(d.specialisation)}</option>`).join("");
  const myDoctor = state.user.role === "doctor" ? await api("/doctors/me").catch(() => null) : null;
  let form = "";
  if (can("book")) {
    form = `<form data-form="book-appointment" class="panel"><div class="panel-heading"><div><h2>Book an appointment</h2><p>Select a clinician and an available UTC time.</p></div></div><div class="form-grid">
      <div class="field"><label>Doctor</label><select name="doctor_id" required><option value="">Choose a doctor</option>${options}</select></div>
      ${state.user.role !== "patient" ? `<div class="field"><label>Patient ID</label><input name="patient_id" type="number" min="1" required placeholder="Patient record ID"></div>` : ""}
      <div class="field"><label>Date and time (your local time)</label><input name="scheduled_at" type="datetime-local" required></div>
      <div class="field"><label>Reason for visit</label><input name="reason" maxlength="500" placeholder="Optional"></div>
      </div><div class="form-actions"><button class="button" type="submit">Book appointment</button><span class="form-note">Local time is converted to UTC and must fit the doctor's availability.</span></div></form>`;
  }
  const availabilityForm = managesAvailability ? `<form data-form="add-availability" class="panel"><div class="panel-heading"><div><h2>Publish doctor availability</h2><p>Set a recurring weekly UTC block. Booking slots follow this schedule.</p></div></div><div class="form-grid">
      ${state.user.role === "doctor" ? `<input type="hidden" name="doctor_id" value="${myDoctor?.id || ""}">` : `<div class="field"><label>Doctor</label><select name="doctor_id" required><option value="">Choose a doctor</option>${options}</select></div>`}
      <div class="field"><label>Weekday</label><select name="weekday"><option value="0">Monday</option><option value="1">Tuesday</option><option value="2">Wednesday</option><option value="3">Thursday</option><option value="4">Friday</option><option value="5">Saturday</option><option value="6">Sunday</option></select></div>
      <div class="field"><label>Start time (UTC)</label><input name="start_time" type="time" value="09:00" required></div><div class="field"><label>End time (UTC)</label><input name="end_time" type="time" value="17:00" required></div><div class="field"><label>Slot length</label><select name="slot_minutes"><option value="15">15 minutes</option><option value="30" selected>30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></div>
      </div><div class="form-actions"><button class="button" type="submit" ${state.user.role === "doctor" && !myDoctor ? "disabled" : ""}>Publish availability</button><span class="form-note">Add different weekday blocks separately.</span></div></form>` : "";
  const cards = listCards(rows, row => {
    const actions = [];
    if (state.user.role === "patient" && ["pending", "confirmed"].includes(row.status)) actions.push(`<button class="button button-small button-danger" data-action="cancel-appointment" data-id="${row.id}">Cancel</button>`);
    if (can("manageAppointment") && row.status === "pending") actions.push(`<button class="button button-small" data-action="appointment-status" data-status="confirmed" data-id="${row.id}">Confirm</button>`);
    if (["hospital_admin", "receptionist"].includes(state.user.role) && ["pending", "confirmed"].includes(row.status)) actions.push(`<button class="button button-small button-quiet" data-action="cancel-appointment" data-id="${row.id}">Cancel</button>`);
    if (state.user.role === "doctor" && row.status === "confirmed") actions.push(`<button class="button button-small" data-action="appointment-status" data-status="in_progress" data-id="${row.id}">Start visit</button>`);
    if (state.user.role === "doctor" && row.status === "in_progress") actions.push(`<button class="button button-small" data-action="appointment-status" data-status="completed" data-id="${row.id}">Complete visit</button>`);
    return `<article class="list-card"><div class="list-card-head"><div><h3>Appointment #${row.id}</h3><p>${escapeHtml(row.reason || "General appointment")}</p></div>${badge(row.status)}</div><div class="list-meta"><span>Patient ID: ${row.patientId}</span><span>Doctor ID: ${row.doctorId}</span><span>${dateLabel(row.scheduledAt)}</span></div>${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}</article>`;
  }, "No appointments yet");
  return `${pageIntro("Appointments", "Book visits and follow each appointment through care.")}${availabilityForm}${form}${panel("Recent appointments", cards, "Appointments available to your account")}`;
}

async function renderClinical() {
  const [records, prescriptions, appointments] = await Promise.all([
    safeList("/records?limit=100"), safeList("/prescriptions?limit=100"), safeList("/appointments?limit=100"),
  ]);
  const eligible = appointments.filter(a => ["confirmed", "in_progress", "completed"].includes(a.status));
  const options = eligible.map(a => `<option value="${a.id}">#${a.id} · patient ${a.patientId} · ${dateLabel(a.scheduledAt)}</option>`).join("");
  const forms = state.user.role === "doctor" ? `
    <div class="grid grid-2">
      <form data-form="create-record" class="panel"><div class="panel-heading"><div><h2>Write visit record</h2><p>Only for your confirmed appointments.</p></div></div><div class="form-grid"><div class="field full"><label>Appointment</label><select name="appointment_id" required><option value="">Choose appointment</option>${options}</select></div><div class="field full"><label>Diagnosis</label><textarea name="diagnosis" required maxlength="5000"></textarea></div><div class="field"><label>Chief complaint</label><input name="chief_complaint" maxlength="500"></div><div class="field"><label>Symptoms</label><input name="symptoms" maxlength="5000"></div><div class="field full"><label>Treatment plan</label><textarea name="treatment_plan" maxlength="5000"></textarea></div></div><div class="form-actions"><button class="button" type="submit">Save record</button></div></form>
      <form data-form="create-prescription" class="panel"><div class="panel-heading"><div><h2>Create prescription</h2><p>Save a visit record first.</p></div></div><div class="form-grid"><div class="field full"><label>Appointment</label><select name="appointment_id" required><option value="">Choose appointment</option>${options}</select></div><div class="field"><label>Medicine name</label><input name="medicine_name" required maxlength="200"></div><div class="field"><label>Dosage</label><input name="dosage" required maxlength="120" placeholder="1 tablet"></div><div class="field"><label>Frequency</label><input name="frequency" required maxlength="120" placeholder="Twice daily"></div><div class="field"><label>Duration</label><input name="duration" required maxlength="120" placeholder="5 days"></div><div class="field full"><label>Instructions</label><input name="instructions" maxlength="500"></div></div><div class="form-actions"><button class="button" type="submit">Save prescription</button></div></form>
    </div>` : "";
  const recordCards = listCards(records, row => `<article class="list-card"><div class="list-card-head"><div><h3>${escapeHtml(row.diagnosis)}</h3><p>Appointment #${row.appointmentId} · Patient ${row.patientId}</p></div><span class="badge">${dateLabel(row.createdAt)}</span></div>${row.treatmentPlan ? `<div class="list-meta"><span>${escapeHtml(row.treatmentPlan)}</span></div>` : ""}</article>`, "No clinical records");
  const rxCards = listCards(prescriptions, row => `<article class="list-card"><div class="list-card-head"><div><h3>Prescription #${row.id}</h3><p>Appointment #${row.appointmentId} · Patient ${row.patientId}</p></div><span class="badge">${dateLabel(row.createdAt)}</span></div><div class="list-meta">${row.items.map(item => `<span><strong>${escapeHtml(item.medicineName)}</strong> · ${escapeHtml(item.dosage)} · ${escapeHtml(item.frequency)} · ${escapeHtml(item.duration)}</span>`).join("")}</div></article>`, "No prescriptions");
  return `${pageIntro("Clinical care", "Visit notes, diagnoses, treatment plans, and prescriptions.")}${forms}<div class="grid grid-2">${panel("Visit records", recordCards)}${panel("Prescriptions", rxCards)}</div>`;
}

async function renderLabs() {
  const [orders, appointments] = await Promise.all([
    safeList("/lab-orders?limit=100"), state.user.role === "doctor" ? safeList("/appointments?limit=100") : Promise.resolve([]),
  ]);
  const eligible = appointments.filter(a => ["confirmed", "in_progress", "completed"].includes(a.status));
  const doctorForm = state.user.role === "doctor" ? `<form data-form="create-lab" class="panel"><div class="panel-heading"><div><h2>Order a test</h2><p>Order a test for an assigned visit.</p></div></div><div class="form-grid"><div class="field"><label>Appointment</label><select name="appointment_id" required><option value="">Choose appointment</option>${eligible.map(a => `<option value="${a.id}">Appointment #${a.id} · patient ${a.patientId}</option>`).join("")}</select></div><div class="field"><label>Test name</label><input name="test_name" maxlength="200" required></div><div class="field full"><label>Notes for the laboratory</label><textarea name="notes" maxlength="2000"></textarea></div></div><div class="form-actions"><button class="button" type="submit">Order test</button></div></form>` : "";
  const cards = listCards(orders, row => {
    const actions = [];
    if (state.user.role === "lab_technician" && row.status === "ordered") actions.push(`<button class="button button-small" data-action="upload-lab" data-id="${row.id}">Upload result</button>`);
    if (["doctor", "hospital_admin"].includes(state.user.role) && row.status === "result_ready") actions.push(`<button class="button button-small" data-action="approve-lab" data-id="${row.id}">Approve result</button>`);
    return `<article class="list-card"><div class="list-card-head"><div><h3>${escapeHtml(row.testName)}</h3><p>Order #${row.id} · Appointment #${row.appointmentId} · Patient ${row.patientId}</p></div>${badge(row.status)}</div>${row.notes ? `<div class="list-meta"><span>Notes: ${escapeHtml(row.notes)}</span></div>` : ""}${row.resultText ? `<div class="notice" style="margin-top:12px"><strong>Result:</strong> ${escapeHtml(row.resultText)}</div>` : ""}${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}</article>`;
  }, "No lab orders");
  return `${pageIntro("Laboratory", "Track test orders, result uploads, and clinical review.")}${doctorForm}${panel("Lab orders", cards)}`;
}

async function renderPharmacy() {
  const [medicines, prescriptions] = await Promise.all([
    safeList("/medicines"), safeList("/prescriptions?limit=100"),
  ]);
  const inventoryForm = can("inventory") ? `<div class="grid grid-2">
    <form data-form="create-medicine" class="panel"><div class="panel-heading"><div><h2>Add medicine</h2><p>Create a hospital catalogue entry.</p></div></div><div class="form-grid"><div class="field"><label>Name</label><input name="name" required maxlength="200"></div><div class="field"><label>SKU</label><input name="sku" required maxlength="80"></div><div class="field"><label>Unit</label><input name="unit" value="unit" required maxlength="40"></div><div class="field"><label>Reorder level</label><input name="reorder_level" type="number" min="0" value="0"></div></div><div class="form-actions"><button class="button" type="submit">Add medicine</button></div></form>
    <form data-form="receive-batch" class="panel"><div class="panel-heading"><div><h2>Receive stock</h2><p>Record batch and expiry information.</p></div></div><div class="form-grid"><div class="field full"><label>Medicine</label><select name="medicine_id" required><option value="">Choose medicine</option>${medicines.map(m => `<option value="${m.id}">${escapeHtml(m.name)} · ${escapeHtml(m.sku)}</option>`).join("")}</select></div><div class="field"><label>Batch number</label><input name="batch_number" required maxlength="100"></div><div class="field"><label>Expiry date</label><input name="expiry_date" type="date" required></div><div class="field"><label>Quantity received</label><input name="quantity" type="number" min="1" required></div><div class="field"><label>Unit cost</label><input name="unit_cost" type="number" min="0" step="0.01" required></div></div><div class="form-actions"><button class="button" type="submit">Receive batch</button></div></form>
  </div>` : "";
  const medRows = medicines.map(m => `<tr><td><strong>${escapeHtml(m.name)}</strong></td><td>${escapeHtml(m.sku)}</td><td>${escapeHtml(m.unit)}</td><td>${m.availableStock}</td><td>${m.lowStock ? `<span class="badge warn">Low stock</span>` : `<span class="badge good">In stock</span>`}</td></tr>`);
  const rxCards = listCards(prescriptions, rx => {
    const dispenseForm = can("dispense") ? `<form data-form="dispense" data-rxid="${rx.id}"><div class="rx-lines">${rx.items.map(item => `<label class="rx-line"><span>${escapeHtml(item.medicineName)} · ${escapeHtml(item.dosage)} (${escapeHtml(item.frequency)} for ${escapeHtml(item.duration)})</span><input name="line-${item.id}" type="number" min="1" value="1" required aria-label="Quantity for ${escapeHtml(item.medicineName)}"></label>`).join("")}</div><div class="form-actions"><button class="button button-small" type="submit">Dispense prescription</button><span class="form-note">All lines dispense together; stock is deducted by oldest batch first.</span></div></form>` : `<div class="list-meta">${rx.items.map(item => `<span>${escapeHtml(item.medicineName)} · ${escapeHtml(item.dosage)}</span>`).join("")}</div>`;
    return `<article class="list-card"><div class="list-card-head"><div><h3>Prescription #${rx.id}</h3><p>Patient ${rx.patientId} · Appointment #${rx.appointmentId}</p></div><span class="badge">${dateLabel(rx.createdAt)}</span></div>${dispenseForm}</article>`;
  }, "No prescriptions ready for pharmacy");
  return `${pageIntro("Pharmacy", "Manage medicine stock and dispense prescriptions safely.")}${inventoryForm}${panel("Medicine inventory", table(["Medicine", "SKU", "Unit", "Available", "Stock status"], medRows))}${panel("Prescriptions", rxCards, "Only unexpired stock is counted and dispensed")}`;
}

async function renderBilling() {
  const bills = await safeList("/bills?limit=100");
  const appointments = can("billing") && state.user.role !== "accountant" ? await safeList("/appointments?limit=100") : [];
  const appointmentField = state.user.role === "accountant"
    ? `<div class="field"><label>Appointment ID</label><input name="appointment_id" type="number" min="1" placeholder="Enter appointment ID" required></div>`
    : `<div class="field"><label>Appointment ID</label><select name="appointment_id" required><option value="">Choose appointment</option>${appointments.map(a => `<option value="${a.id}">Appointment #${a.id} · patient ${a.patientId}</option>`).join("")}</select></div>`;
  const form = can("billing") ? `<form data-form="create-bill" class="panel"><div class="panel-heading"><div><h2>Create a bill</h2><p>Link the bill to an appointment.</p></div></div><div class="form-grid">${appointmentField}<div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Currency</label><select name="currency"><option>INR</option><option>USD</option><option>EUR</option></select></div><div class="field"><label>Description</label><input name="description" maxlength="500" value="Consultation"></div></div><div class="form-actions"><button class="button" type="submit">Create bill</button></div></form>` : "";
  const rows = bills.map(b => `<tr><td><strong>Bill #${b.id}</strong></td><td>Appointment #${b.appointmentId}</td><td>${currency(b.amount, b.currency)}</td><td>${badge(b.status)}</td><td>${dateLabel(b.createdAt)}</td><td>${can("billing") ? `<button class="button button-small button-quiet" data-action="toggle-bill" data-id="${b.id}" data-status="${b.status === "paid" ? "unpaid" : "paid"}">Mark ${b.status === "paid" ? "unpaid" : "paid"}</button>` : ""}</td></tr>`);
  return `${pageIntro("Billing", "Review charges, payment status, and account activity.")}${form}${panel("Bills", table(["Bill", "Appointment", "Amount", "Status", "Created", "Action"], rows))}`;
}

async function renderTeam() {
  const hospitals = state.user.role === "super_admin" ? await safeList("/hospitals") : [];
  const selected = hospitals.find(h => String(h.id) === String(state.hospitalId));
  const switcher = state.user.role === "super_admin" ? `<section class="panel"><div class="panel-heading"><div><h2>Hospital workspaces</h2><p>Choose a hospital to manage its records and view analytics.</p></div></div>${hospitals.length ? hospitals.map(h => `<div class="hospital-card"><div><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(h.code)} · ${h.verified ? "Verified" : "Registration closed"}</small></div><div class="actions" style="margin:0">${!h.verified ? `<button class="button button-small button-outline" data-action="verify-hospital" data-id="${h.id}">Verify</button>` : ""}<button class="button button-small ${String(h.id) === String(state.hospitalId) ? "button-quiet" : ""}" data-action="select-hospital" data-id="${h.id}">${String(h.id) === String(state.hospitalId) ? "Selected" : "Use hospital"}</button></div></div>`).join("") : empty("No hospitals yet", "Create a hospital to begin the demo.")}</section>
    <form data-form="create-hospital" class="panel"><div class="panel-heading"><div><h2>Create hospital</h2><p>This also creates its first administrator.</p></div></div><div class="form-grid"><div class="field"><label>Hospital name</label><input name="name" required></div><div class="field"><label>Hospital code</label><input name="code" pattern="[A-Z0-9-]{3,20}" required></div><div class="field"><label>Admin name</label><input name="admin_name" required></div><div class="field"><label>Admin email</label><input name="admin_email" type="email" required></div><div class="field full"><label>Temporary admin password</label><input name="admin_password" type="password" minlength="8" required></div></div><div class="form-actions"><button class="button" type="submit">Create hospital</button><span class="form-note">Store the temporary password securely and change it before public use.</span></div></form>` : "";
  if (state.user.role === "super_admin" && !selected) return `${pageIntro("Hospital setup", "Create a hospital and prepare its administrator.")}${switcher}`;
  const tenantNotice = state.user.role === "super_admin" ? `<div class="notice" style="margin-bottom:16px">Managing <strong>${escapeHtml(selected?.name || `Hospital ${state.hospitalId}`)}</strong>. Select another hospital above when needed.</div>` : "";
  const [users, departments] = await Promise.all([safeList("/users?limit=100"), safeList(`/hospitals/${state.user.hospitalId || state.hospitalId}/departments`)]);
  const staffForm = state.user.role === "hospital_admin" ? `<div class="grid grid-2"><form data-form="create-department" class="panel"><div class="panel-heading"><div><h2>Add department</h2><p>Organize the clinical team.</p></div></div><div class="field"><label>Department name</label><input name="name" required></div><div class="form-actions"><button class="button" type="submit">Add department</button></div></form>
    <form data-form="create-staff" class="panel"><div class="panel-heading"><div><h2>Add staff member</h2><p>Create a role-specific hospital account.</p></div></div><div class="form-grid"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Temporary password</label><input name="password" type="password" minlength="8" required></div><div class="field"><label>Role</label><select name="role"><option value="doctor">Doctor</option><option value="nurse">Nurse</option><option value="receptionist">Receptionist</option><option value="lab_technician">Lab technician</option><option value="pharmacist">Pharmacist</option><option value="accountant">Accountant</option></select></div><div class="field"><label>Department</label><select name="department_id"><option value="">General / none</option>${departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select></div><div class="field"><label>Specialisation</label><input name="specialisation" value="General"></div></div><div class="form-actions"><button class="button" type="submit">Create staff account</button></div></form></div>` : "";
  const userRows = users.map(u => `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(roleLabel(u.role))}</td><td>${u.hospitalId ?? "—"}</td></tr>`);
  const depList = departments.length ? departments.map(d => `<span class="badge">${escapeHtml(d.name)}</span>`).join(" ") : empty("No departments", "Create the first department for this hospital.");
  return `${pageIntro("Hospital setup", "Manage teams, departments, and organization access.")}${switcher}${tenantNotice}${staffForm}${panel("Departments", depList)}${panel("Team directory", table(["Name", "Email", "Role", "Hospital"], userRows))}`;
}

async function renderNotifications() {
  const rows = await safeList("/notifications/me?limit=100");
  const cards = listCards(rows, row => `<article class="list-card"><div class="list-card-head"><div><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.body)}</p></div>${row.readAt ? `<span class="badge">Read</span>` : `<span class="badge good">New</span>`}</div><div class="list-meta"><span>${escapeHtml(titleCase(row.category))}</span><span>${dateLabel(row.createdAt)}</span></div>${!row.readAt ? `<div class="actions"><button class="button button-small button-quiet" data-action="read-notification" data-id="${row.id}">Mark as read</button></div>` : ""}</article>`, "All caught up");
  return `${pageIntro("Notifications", "Care, lab, pharmacy, and payment updates for your account.")}${panel("Recent notifications", cards)}`;
}

function persistSession(data) {
  state.token = data.accessToken;
  state.user = data.user;
  sessionStorage.setItem("medcore.access", state.token);
  sessionStorage.setItem("medcore.user", JSON.stringify(state.user));
  if (state.user?.hospitalId) {
    state.hospitalId = String(state.user.hospitalId);
    sessionStorage.setItem("medcore.hospital", state.hospitalId);
  }
  state.page = "dashboard";
  showApplication();
}

function signOut(notify = true) {
  fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  state.token = "";
  state.user = null;
  sessionStorage.removeItem("medcore.access");
  sessionStorage.removeItem("medcore.user");
  sessionStorage.removeItem("medcore.hospital");
  state.hospitalId = "";
  showSignIn();
  if (notify) toast("You have signed out.");
}

function formObject(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const [key, value] of Object.entries(values)) values[key] = typeof value === "string" ? value.trim() : value;
  return values;
}

function setFormBusy(form, busy) {
  const button = $("button[type=submit]", form);
  if (!button) return;
  button.disabled = busy;
  if (busy) { button.dataset.oldLabel = button.textContent; button.textContent = "Please wait…"; }
  else if (button.dataset.oldLabel) { button.textContent = button.dataset.oldLabel; delete button.dataset.oldLabel; }
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  const values = formObject(form);
  setFormBusy(form, true);
  try {
    if (kind === "login") {
      state.token = "";
      const result = await api("/auth/login", { method: "POST", body: values });
      persistSession(result);
      toast(`Welcome, ${result.user.name}.`);
      return;
    }
    if (kind === "register") {
      await api("/auth/register", { method: "POST", body: values });
      let code = "";
      try { code = (await api(`/auth/dev-otp?email=${encodeURIComponent(values.email)}`)).code || ""; } catch { /* real email provider may deliver it */ }
      showVerify(values.email, code);
      toast("Account created. Verify your email to continue.");
      return;
    }
    if (kind === "verify") {
      await api("/auth/verify-email", { method: "POST", body: { email: form.dataset.email, otp: values.otp } });
      showSignIn(form.dataset.email);
      toast("Email verified. You can now sign in.");
      return;
    }
    if (kind === "add-availability") {
      values.doctor_id = Number(values.doctor_id);
      values.weekday = Number(values.weekday);
      values.slot_minutes = Number(values.slot_minutes);
      await api(`/doctors/${values.doctor_id}/availability`, { method: "POST", body: values });
    } else if (kind === "book-appointment") {
      values.doctor_id = Number(values.doctor_id);
      if (values.patient_id) values.patient_id = Number(values.patient_id);
      values.scheduled_at = new Date(values.scheduled_at).toISOString();
      await api("/appointments", { method: "POST", body: values });
    } else if (kind === "create-record") {
      const appointmentId = Number(values.appointment_id); delete values.appointment_id;
      await api(`/appointments/${appointmentId}/records`, { method: "POST", body: values });
    } else if (kind === "create-prescription") {
      const appointmentId = Number(values.appointment_id); delete values.appointment_id;
      const item = Object.fromEntries(["medicine_name", "dosage", "frequency", "duration", "instructions"].map(k => [k, values[k]]));
      await api(`/appointments/${appointmentId}/prescriptions`, { method: "POST", body: { instructions: "", items: [item] } });
    } else if (kind === "create-lab") {
      const appointmentId = Number(values.appointment_id); delete values.appointment_id;
      await api(`/appointments/${appointmentId}/lab-orders`, { method: "POST", body: values });
    } else if (kind === "create-medicine") {
      values.reorder_level = Number(values.reorder_level || 0);
      await api("/medicines", { method: "POST", body: values });
    } else if (kind === "receive-batch") {
      const medicineId = Number(values.medicine_id); delete values.medicine_id;
      values.quantity = Number(values.quantity);
      await api(`/medicines/${medicineId}/batches`, { method: "POST", body: values });
    } else if (kind === "dispense") {
      const items = Object.entries(values).filter(([key]) => key.startsWith("line-")).map(([key, quantity]) => ({
        prescription_item_id: Number(key.slice(5)), quantity: Number(quantity),
      }));
      await api(`/prescriptions/${Number(form.dataset.rxid)}/dispense`, { method: "POST", body: { items } });
    } else if (kind === "create-bill") {
      const appointmentId = Number(values.appointment_id); delete values.appointment_id;
      await api(`/appointments/${appointmentId}/bill`, { method: "POST", body: values });
    } else if (kind === "create-hospital") {
      const result = await api("/hospitals", { method: "POST", body: values });
      toast(`Hospital ${result.name} created. Verify it to open registration.`);
      await renderPage();
      return;
    } else if (kind === "create-department") {
      await api("/departments", { method: "POST", body: values });
    } else if (kind === "create-staff") {
      if (values.department_id) values.department_id = Number(values.department_id); else delete values.department_id;
      await api("/users", { method: "POST", body: values });
    }
    toast("Saved successfully.");
    await renderPage();
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (document.contains(form)) setFormBusy(form, false);
  }
}

async function handleAction(button) {
  const action = button.dataset.action;
  const id = Number(button.dataset.id);
  try {
    if (action === "show-register") return showRegister();
    if (action === "show-login") return showSignIn();
    if (action === "verify-hospital") await api(`/hospitals/${id}/verify`, { method: "POST" });
    else if (action === "select-hospital") {
      state.hospitalId = String(id);
      sessionStorage.setItem("medcore.hospital", state.hospitalId);
      toast("Hospital workspace selected.");
    } else if (action === "appointment-status") await api(`/appointments/${id}/status`, { method: "PATCH", body: { status: button.dataset.status } });
    else if (action === "cancel-appointment") await api(`/appointments/${id}/cancel`, { method: "PATCH" });
    else if (action === "approve-lab") await api(`/lab-orders/${id}/approve`, { method: "PATCH" });
    else if (action === "upload-lab") {
      const result = prompt("Enter the laboratory result:");
      if (result === null || !result.trim()) return;
      await api(`/lab-orders/${id}/result`, { method: "PATCH", body: { result_text: result.trim() } });
    } else if (action === "toggle-bill") await api(`/bills/${id}/status`, { method: "PATCH", body: { status: button.dataset.status } });
    else if (action === "read-notification") await api(`/notifications/${id}/read`, { method: "PATCH" });
    else return;
    toast("Update complete.");
    await renderPage();
  } catch (error) { toast(error.message, true); }
}

document.addEventListener("submit", handleSubmit);
document.addEventListener("click", event => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton && state.user) {
    state.page = pageButton.dataset.page;
    showApplication();
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton);
});
$("#logoutButton").addEventListener("click", () => signOut());

window.addEventListener("DOMContentLoaded", async () => {
  if (!state.token) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return showSignIn();
  }
  try {
    state.user = await api("/auth/me");
    sessionStorage.setItem("medcore.user", JSON.stringify(state.user));
    if (state.user.hospitalId && state.user.role !== "super_admin") state.hospitalId = String(state.user.hospitalId);
    showApplication();
  } catch { showSignIn(); }
});
