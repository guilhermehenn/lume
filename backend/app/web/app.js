"use strict";

// Página provisória de status. Todo texto vindo da API entra com textContent (nunca innerHTML).

const REASONS = {
  auto: "automático",
  manual: "manual",
  "pre-migration": "antes de atualizar",
  "pre-restore": "antes de restaurar",
};

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${numberFmt.format(bytes / 1024)} KB`;
  return `${numberFmt.format(bytes / (1024 * 1024))} MB`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFmt.format(date);
}

function fillList(dl, rows) {
  dl.replaceChildren();
  for (const [label, value, mono] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (mono) dd.className = "mono";
    dl.append(dt, dd);
  }
}

async function getJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function setStatus(state, text) {
  const pill = document.getElementById("status");
  pill.dataset.state = state;
  document.getElementById("status-text").textContent = text;
}

function renderBackups(items) {
  const list = document.getElementById("backup-list");
  list.replaceChildren();
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhum backup ainda.";
    list.append(li);
    return;
  }
  for (const item of items.slice(0, 8)) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "when";
    left.textContent = formatDate(item.created_at);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = REASONS[item.reason] ?? item.reason;
    left.append(badge);
    const right = document.createElement("span");
    right.className = "meta";
    right.textContent = formatBytes(item.size_bytes);
    li.append(left, right);
    list.append(li);
  }
}

async function refresh() {
  try {
    const [info, backups] = await Promise.all([getJSON("/api/system/info"), getJSON("/api/backups")]);
    document.getElementById("app-name").textContent = info.app;
    document.title = `${info.app} · ambiente pronto`;
    setStatus("ok", "API online");

    const db = info.database;
    fillList(document.getElementById("db-info"), [
      ["Arquivo", db.path, true],
      ["Tamanho", formatBytes(db.size_bytes)],
      ["Modo", String(db.journal_mode).toUpperCase()],
      ["Chaves estrangeiras", db.foreign_keys ? "ativas" : "desligadas"],
      ["Esquema", db.schema_revision === db.schema_head ? `revisão ${db.schema_revision}` : "pendente"],
    ]);

    const bk = info.backups;
    fillList(document.getElementById("backup-info"), [
      ["Quantidade", String(bk.count)],
      ["Último", bk.latest ? formatDate(bk.latest.created_at) : "nenhum"],
      ["Retenção", `${bk.keep_daily} diários + ${bk.keep_weekly} semanais`],
      ["Cópia extra", bk.extra_folder ? "ativada" : "desativada"],
    ]);

    fillList(document.getElementById("env-info"), [
      ["Versão do app", info.version],
      ["Python", info.python],
      ["SQLite", info.sqlite],
      ["Sistema", info.os],
    ]);

    renderBackups(backups);
  } catch (error) {
    setStatus("error", "API fora do ar");
    console.error(error);
  }
}

async function backupNow() {
  const button = document.getElementById("backup-btn");
  const msg = document.getElementById("backup-msg");
  button.disabled = true;
  msg.dataset.state = "";
  msg.textContent = "Criando backup…";
  try {
    const response = await fetch("/api/backups", {
      method: "POST",
      headers: { "X-App-Request": "1", Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `${response.status}`);
    msg.dataset.state = "ok";
    msg.textContent = `Backup criado (${formatBytes(body.size_bytes)}).`;
    await refresh();
  } catch (error) {
    msg.dataset.state = "error";
    msg.textContent = `Não foi possível criar o backup: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

document.getElementById("backup-btn").addEventListener("click", backupNow);
refresh();
