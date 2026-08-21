#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from "node:fs";
import https from "node:https";
import { homedir, networkInterfaces, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const GIT_BUILD = "https://github.com/bg-isma/Verbbe.git#main:server";
const IMAGE = "ghcr.io/bg-isma/verbbe:latest";
const DEFAULT_PORT = 4747;
const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";

const lime = "\x1b[38;2;79;255;111m";
const dim = "\x1b[38;2;160;160;165m";
const red = "\x1b[38;2;255;79;82m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

const home = homedir();
const configDir = join(home, ".verbbe");
if (!existsSync(configDir) && existsSync(join(home, ".nookplay"))) {
  renameSync(join(home, ".nookplay"), configDir);
}
const composePath = join(configDir, "compose.yml");
const envPath = join(configDir, "env");

function say(msg = "") {
  process.stdout.write(`${msg}\n`);
}

function note(msg = "") {
  process.stderr.write(`${msg}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`${red}${msg}${reset}\n`);
  process.exit(code);
}

function colorEnabled() {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";
}

function paint(code, text) {
  return colorEnabled() ? `${code}${text}${reset}` : text;
}

function banner() {
  say();
  say(`  ${paint(lime + bold, "verbbe")}  ${paint(dim, VERSION)}`);
  say();
}

function usage() {
  say(`${paint(bold, "verbbe")} — your music, on your computer`);
  say();
  say("  start     [--music PATH] [--port 4747] [--name Verbbe] [--mode lan|tailscale]");
  say("            [--native] [--no-open] [--yes] [--tailscale-auth-key KEY]");
  say("  stop      stop the server (music files stay)");
  say("  uninstall [--yes] [--keep-data]   stop and remove the service");
  say("  restart");
  say("  status");
  say("  url");
  say("  logs      [-f]");
  say("  open");
  say("  help");
  say("  version");
  say();
  say("  curl -fsSL https://verbbe.com/install.sh | bash   # no Node needed");
  say("  npx verbbe start --music ~/Music                  # if you already have Node");
  say();
  say("  lan        phone on the same Wi-Fi");
  say("  tailscale  public HTTPS (Funnel). Only this computer runs Tailscale;");
  say("             anyone with Verbbe pastes the Away URL — no extra app.");
  say();
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--music" || token === "-m") args.music = argv[++i];
    else if (token === "--port" || token === "-p") args.port = argv[++i];
    else if (token === "--name") args.name = argv[++i];
    else if (token === "--mode") args.mode = argv[++i];
    else if (token === "--tailscale-auth-key") args.tailscaleAuthKey = argv[++i];
    else if (token === "--native") args.native = true;
    else if (token === "--no-open") args.noOpen = true;
    else if (token === "--yes" || token === "-y") args.yes = true;
    else if (token === "--keep-data") args.keepData = true;
    else if (token === "-f" || token === "--follow") args.follow = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--version" || token === "-v") args.version = true;
    else if (token.startsWith("-")) fail(`Unknown flag: ${token}`);
    else args._.push(token);
  }
  return args;
}

function findServerDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, "server");
    if (existsSync(join(candidate, "Dockerfile"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const fromCwd = join(process.cwd(), "server");
  if (existsSync(join(fromCwd, "Dockerfile"))) return fromCwd;
  return null;
}

function defaultMusicDir() {
  const candidates = [
    join(home, "Music"),
    join(home, "Música"),
    process.platform === "win32" ? join(home, "My Music") : null,
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) || join(home, "Music");
}

function isTailscaleIp(ip) {
  const parts = String(ip).split(".").map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isPrivateOrLocalIp(ip) {
  const parts = String(ip).split(".").map(Number);
  const a = parts[0];
  const b = parts[1];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return isTailscaleIp(ip);
}

function lanAddresses() {
  const nets = networkInterfaces();
  const out = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      const v4 = net.family === "IPv4" || net.family === 4;
      if (v4 && !net.internal && !isTailscaleIp(net.address) && net.address !== "169.254.0.0") {
        if (!String(net.address).startsWith("169.254.")) out.push(net.address);
      }
    }
  }
  return out;
}

function which(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [cmd], { encoding: "utf8" });
  return result.status === 0;
}

function dockerCompose() {
  const modern = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (modern.status === 0) return { bin: "docker", prefix: ["compose"] };
  const legacy = spawnSync("docker-compose", ["version"], { encoding: "utf8" });
  if (legacy.status === 0) return { bin: "docker-compose", prefix: [] };
  return null;
}

function dockerDaemonUp() {
  return spawnSync("docker", ["info"], { encoding: "utf8", stdio: "pipe" }).status === 0;
}

async function waitForDockerDaemon(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dockerCompose() && dockerDaemonUp()) return true;
    await sleep(2000);
  }
  return false;
}

async function ensureDocker() {
  if (dockerCompose() && dockerDaemonUp()) return dockerCompose();
  if (dockerCompose() && !dockerDaemonUp()) {
    note(paint(dim, "  Docker is installed — opening it…"));
    if (platform() === "darwin") {
      spawnSync("open", ["-a", "Docker"], { encoding: "utf8" });
      spawnSync("open", ["-a", "Docker Desktop"], { encoding: "utf8" });
    }
    if (await waitForDockerDaemon()) return dockerCompose();
    fail("Open Docker Desktop and wait until it is running, then re-run.");
  }

  note(paint(dim, "  Docker is missing — installing it…"));
  const os = platform();
  if (os === "darwin") {
    if (!which("brew")) {
      fail("Homebrew is missing. Install Docker Desktop from https://docs.docker.com/get-docker/ and re-run.");
    }
    let installed = false;
    for (const cask of ["docker-desktop", "docker"]) {
      const fresh = run("brew", ["install", "--cask", cask], { allowFail: true });
      if (fresh.status === 0) {
        installed = true;
        break;
      }
    }
    if (!installed) fail("Could not install Docker. See https://docs.docker.com/get-docker/");
    spawnSync("open", ["-a", "Docker"], { encoding: "utf8" });
    spawnSync("open", ["-a", "Docker Desktop"], { encoding: "utf8" });
    note(paint(dim, "  Waiting for Docker Desktop to start…"));
    if (await waitForDockerDaemon(180_000)) return dockerCompose();
    fail("Docker Desktop is installed. Open it, finish the first-run screens, then re-run.");
  }
  if (os === "linux") {
    const result = spawnSync("sh", ["-c", "curl -fsSL https://get.docker.com | sh"], {
      stdio: "inherit",
      encoding: "utf8",
    });
    if (result.status !== 0) fail("Could not install Docker. See https://docs.docker.com/get-docker/");
    spawnSync("sudo", ["usermod", "-aG", "docker", process.env.USER || ""], { encoding: "utf8" });
    if (await waitForDockerDaemon(60_000)) return dockerCompose();
    fail("Docker is installed. Log out and back in (or run: sudo service docker start), then re-run.");
  }
  fail("Install Docker Desktop from https://docs.docker.com/get-docker/ and re-run.");
}

function run(bin, argv, opts = {}) {
  const result = spawnSync(bin, argv, {
    stdio: opts.silent ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    shell: opts.shell || false,
  });
  if (result.error?.code === "ENOENT") fail(`Command not found: ${bin}`);
  if (result.status !== 0 && !opts.allowFail) {
    fail(opts.failMessage || `${bin} ${argv.join(" ")} failed`);
  }
  return result;
}

function composeFile(serverDir) {
  const context = serverDir || GIT_BUILD;
  return `# generated by verbbe ${VERSION}
name: verbbe
services:
  verbbe:
    container_name: verbbe
    image: ${IMAGE}
    build:
      context: ${JSON.stringify(context)}
    ports:
      - "\${VERBBE_PORT:-4747}:4747"
    environment:
      DATA_DIR: /data
      MUSIC_DIR: /music
      SERVER_NAME: \${VERBBE_NAME:-Verbbe}
      TRUST_PROXY: \${VERBBE_TRUST_PROXY:-0}
    volumes:
      - verbbe-data:/data
      - \${VERBBE_MUSIC}:/music:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4747/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
volumes:
  verbbe-data:
`;
}

function readEnvFile() {
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function writeEnv({ music, port, name, mode, funnel, publicAway }) {
  mkdirSync(configDir, { recursive: true });
  const previous = readEnvFile();
  const published = publicAway == null ? previous.VERBBE_FUNNEL_PUBLIC === "1" : Boolean(publicAway);
  const body = [
    `VERBBE_MUSIC=${music}`,
    `VERBBE_PORT=${port}`,
    `VERBBE_NAME=${name}`,
    `VERBBE_MODE=${mode}`,
    `VERBBE_FUNNEL=${funnel ? "1" : "0"}`,
    `VERBBE_FUNNEL_PUBLIC=${published ? "1" : "0"}`,
    `VERBBE_TRUST_PROXY=${funnel || mode === "tailscale" ? "1" : "0"}`,
  ].join("\n");
  writeFileSync(envPath, `${body}\n`, { mode: 0o600 });
}

function composeEnv() {
  const saved = readEnvFile();
  return {
    ...process.env,
    VERBBE_MUSIC: saved.VERBBE_MUSIC,
    VERBBE_PORT: saved.VERBBE_PORT || String(DEFAULT_PORT),
    VERBBE_NAME: saved.VERBBE_NAME || "Verbbe",
    VERBBE_TRUST_PROXY: saved.VERBBE_TRUST_PROXY || "0",
  };
}

function ensureCompose(serverDir) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(composePath, composeFile(serverDir));
}

function composeArgs(extra) {
  return ["--env-file", envPath, "-f", composePath, ...extra];
}

function ask(question, fallback) {
  if (!process.stdin.isTTY) return Promise.resolve(fallback);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer) => {
    rl.question(`${paint(dim, question)} ${paint(lime, `(${fallback})`)} `, (answer) => {
      rl.close();
      resolveAnswer(answer.trim() || fallback);
    });
  });
}

function normalizeMode(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "lan" || value === "local" || value === "home" || value === "casa") return "lan";
  if (value === "tailscale" || value === "remote" || value === "funnel" || value === "anywhere" || value === "fuera") {
    return "tailscale";
  }
  return "";
}

async function promptMode() {
  note("");
  note("Where should the phone reach this computer?");
  note("  1) Home Wi-Fi only");
  note("     Phone and this computer on the same network. Nothing published on the internet.");
  note("");
  note("  2) From anywhere (mobile data, another house, friends…)");
  note("     Public HTTPS. Tailscale runs only on this computer.");
  note("     Other devices only need the Verbbe app and your login.");
  note("");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const chosen = await new Promise((resolveChoice) => {
    const askAgain = () => {
      rl.question("Choose [1/2]: ", (answer) => {
        const mode = normalizeMode(answer) || (answer.trim() === "1" ? "lan" : answer.trim() === "2" ? "tailscale" : "");
        if (mode) {
          rl.close();
          resolveChoice(mode);
          return;
        }
        note("Pick 1 (home Wi-Fi) or 2 (anywhere).");
        askAgain();
      });
    };
    askAgain();
  });
  note("");
  note(chosen === "tailscale" ? "Mode: from anywhere." : "Mode: home Wi-Fi only.");
  return chosen;
}

async function resolveMode(args) {
  const flagged = normalizeMode(args.mode);
  if (flagged) return flagged;
  const saved = normalizeMode(readEnvFile().VERBBE_MODE);
  if (args.yes || !process.stdin.isTTY) return saved || "lan";
  if (saved) return saved;
  return promptMode();
}

async function resolveMusic(args) {
  if (args.music) return resolve(args.music.replace(/^~(?=$|[/\\])/, home));
  const fallback = readEnvFile().VERBBE_MUSIC || defaultMusicDir();
  if (args.yes || !process.stdin.isTTY) return resolve(fallback);
  const typed = await ask("Music folder", fallback);
  return resolve(typed.replace(/^~(?=$|[/\\])/, home));
}

function accessURLs(mode, port) {
  const localhost = `http://127.0.0.1:${port}`;
  const lan = lanAddresses();
  const homeUrl = lan[0] ? `http://${lan[0]}:${port}` : localhost;
  let remote = "";
  if (mode === "tailscale") {
    const ts = tailscaleInfo();
    if (ts.dnsName) remote = `https://${ts.dnsName}`;
  }
  return { localhost, home: homeUrl, remote, lan };
}

async function printEndpoints(mode, port, awayReady = null) {
  const urls = accessURLs(mode, port);
  say(`  ${paint(dim, "Local")}    ${paint(bold, urls.localhost)}`);
  if (urls.lan.length === 0) {
    say(`  ${paint(dim, "Home")}     same Wi-Fi as this computer, then use this PC's IP`);
  } else {
    for (const ip of urls.lan) {
      say(`  ${paint(dim, "Home")}     ${paint(lime + bold, `http://${ip}:${port}`)}`);
    }
  }
  if (mode === "tailscale") {
    const ready = awayReady == null ? (await probePublicAway()).ok : awayReady;
    if (ready && urls.remote.startsWith("https://")) {
      say(`  ${paint(dim, "Away")}     ${paint(lime + bold, urls.remote)}`);
      say();
      say(`  ${paint(dim, "On this Wi-Fi, paste Home. Anywhere else (or to share), paste Away.")}`);
      say(`  ${paint(dim, "Away is public HTTPS. Other people only need Verbbe — not Tailscale.")}`);
      say(`  ${paint(dim, "Use a strong password.")}`);
    } else {
      say(`  ${paint(dim, "Away")}     ${paint(red, "not on the public internet yet")}`);
      say();
      say(`  ${paint(dim, "Do not paste the .ts.net link yet — phones without Tailscale cannot open it.")}`);
      say(`  ${paint(dim, "Re-run:")} verbbe start --mode tailscale`);
    }
  } else {
    say();
    say(`  ${paint(dim, "From anywhere later:")} verbbe start --mode tailscale`);
  }
  say();
  say(`  ${paint(dim, "1.")} Open Local in a browser. The first account is admin.`);
  say(`  ${paint(dim, "2.")} Add the music folder and scan.`);
  say(`  ${paint(dim, "3.")} In Verbbe: Profile → Server → paste Home or Away.`);
  say();
}

function openUrl(url) {
  const plat = platform();
  if (plat === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  else if (plat === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function waitForEnter(message) {
  if (!process.stdin.isTTY) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolveWait) => {
    rl.question(message, () => {
      rl.close();
      resolveWait();
    });
  });
}

async function probeServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/server-info`);
    if (res.ok) return await res.json();
  } catch {
    /* not up */
  }
  return null;
}

async function waitForServer(port) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const info = await probeServer(port);
    if (info) return info;
    await sleep(700);
  }
  return null;
}

function requireCompose() {
  const compose = dockerCompose();
  if (!compose) {
    fail("Docker is missing. Install Docker Desktop, then run this again.\nhttps://docs.docker.com/get-docker/");
  }
  return compose;
}

function isShellScript(path) {
  try {
    const buf = readFileSync(path);
    return buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21;
  } catch {
    return false;
  }
}

function tailscaleBinWorks(path) {
  if (!existsSync(path)) return false;
  const result = spawnSync(path, ["version"], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return Boolean(text) && !text.includes("No such file");
}

function resolveTailscaleBin() {
  const candidates = [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
  ];
  const looked = spawnSync(process.platform === "win32" ? "where" : "which", ["tailscale"], {
    encoding: "utf8",
  });
  if (looked.status === 0) {
    for (const line of looked.stdout.split("\n")) {
      if (line.trim()) candidates.push(line.trim());
    }
  }
  let fallback = "";
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!tailscaleBinWorks(candidate)) continue;
    if (isShellScript(candidate)) {
      if (!fallback) fallback = candidate;
      continue;
    }
    return candidate;
  }
  return fallback || "";
}

function tailscaleInfo() {
  const info = { installed: false, running: false, ip: "", hostname: "", dnsName: "" };
  const bin = resolveTailscaleBin();
  if (!bin) return info;
  info.installed = true;
  const ipOut = spawnSync(bin, ["ip", "-4"], { encoding: "utf8" });
  if (ipOut.status === 0) {
    info.running = true;
    info.ip = (ipOut.stdout || "").trim();
  }
  const hostOut = spawnSync("hostname", [], { encoding: "utf8" });
  if (hostOut.status === 0) info.hostname = (hostOut.stdout || "").trim();
  const status = spawnSync(bin, ["status", "--json"], { encoding: "utf8" });
  if (status.status !== 0) return info;
  info.running = true;
  try {
    const parsed = JSON.parse(status.stdout || "{}");
    const self = parsed.Self || {};
    info.dnsName = String(self.DNSName || "").replace(/\.$/, "");
    if (!info.hostname && self.HostName) info.hostname = self.HostName;
    if (!info.ip) {
      for (const ip of self.TailscaleIPs || []) {
        if (String(ip).includes(".")) {
          info.ip = ip;
          break;
        }
      }
    }
  } catch {
    /* ignore malformed status */
  }
  return info;
}

async function waitTailscaleReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "no IP yet";
  while (Date.now() < deadline) {
    const info = tailscaleInfo();
    if (info.ip) return info;
    last = info.installed ? "no IP yet" : "CLI not ready";
    await sleep(2000);
  }
  fail(`Tailscale did not become ready (${last}). Finish login in the Tailscale app and re-run.`);
}

function installTailscale() {
  const os = platform();
  if (os === "darwin") {
    if (!which("brew")) {
      fail(`Homebrew is missing. Install Tailscale from ${TAILSCALE_DOWNLOAD} and re-run.`);
    }
    note(paint(dim, "  Installing Tailscale…"));
    let installed = false;
    for (const cask of ["tailscale-app", "tailscale"]) {
      const reinstall = run("brew", ["reinstall", "--cask", cask], { allowFail: true });
      if (reinstall.status === 0) {
        installed = true;
        break;
      }
      const fresh = run("brew", ["install", "--cask", cask], { allowFail: true });
      if (fresh.status === 0) {
        installed = true;
        break;
      }
    }
    if (!installed) fail(`Could not install Tailscale. See ${TAILSCALE_DOWNLOAD}`);
    spawnSync("open", ["-a", "Tailscale"], { encoding: "utf8" });
    return;
  }
  if (os === "linux") {
    note(paint(dim, "  Installing Tailscale…"));
    const result = spawnSync("sh", ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"], {
      stdio: "inherit",
      encoding: "utf8",
    });
    if (result.status !== 0) fail(`Could not install Tailscale. See ${TAILSCALE_DOWNLOAD}`);
    return;
  }
  fail(`Automatic Tailscale install is not available on ${os}. See ${TAILSCALE_DOWNLOAD}`);
}

function runTailscaleUp({ authKey, interactive }) {
  const bin = resolveTailscaleBin();
  if (!bin) fail(`Tailscale CLI not found. Install it from ${TAILSCALE_DOWNLOAD}`);
  const argv = ["up"];
  if (authKey) argv.push(`--authkey=${authKey}`);
  if (interactive && !authKey) {
    note(paint(dim, "  A browser may open — sign in, then come back here."));
    const result = spawnSync(bin, argv, { stdio: "inherit" });
    if (result.status !== 0) fail("Could not connect Tailscale.");
    return;
  }
  if (!authKey) {
    fail("Tailscale is not connected. Re-run without --yes to log in, or pass --tailscale-auth-key.");
  }
  const result = spawnSync(bin, argv, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`tailscale up failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

async function ensureTailscale(args) {
  const interactive = !args.tailscaleAuthKey && Boolean(process.stdin.isTTY) && !args.yes;
  if (args.yes && !args.tailscaleAuthKey && !tailscaleInfo().running) {
    fail("Tailscale login needs a terminal, or pass --tailscale-auth-key with --yes.");
  }

  if (!resolveTailscaleBin()) {
    note(paint(dim, "  Tailscale is missing — installing it…"));
    installTailscale();
    const deadline = Date.now() + 30_000;
    while (!resolveTailscaleBin()) {
      if (Date.now() > deadline) {
        fail("Tailscale installed but the CLI is not ready yet. Open the Tailscale app once and re-run.");
      }
      await sleep(2000);
    }
  }

  const already = tailscaleInfo();
  if (already.running && already.ip) {
    note(`  ${paint(dim, "Tailscale already connected.")} ${already.dnsName || already.ip}`);
    return;
  }

  if (interactive) {
    note("");
    note("  Next: a browser opens to sign in (free Tailscale account).");
    note("  Leave this window open until it finishes.");
    note("");
  }
  note(paint(dim, "  Connecting Tailscale…"));
  runTailscaleUp({ authKey: args.tailscaleAuthKey, interactive });
  note(paint(dim, "  Waiting for Tailscale…"));
  const ready = await waitTailscaleReady(120_000);
  note(`  ${paint(lime, "●")}  Tailscale ready ${paint(dim, ready.dnsName || ready.ip)}`);
}

function extractServeEnableURL(msg) {
  const marker = "https://login.tailscale.com/";
  for (const line of String(msg).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(marker)) return trimmed.split(/\s/)[0];
  }
  const idx = String(msg).indexOf(marker);
  if (idx < 0) return "";
  const rest = String(msg).slice(idx);
  const end = rest.search(/[\s]/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function proxyStatusEnabled(kind) {
  const bin = resolveTailscaleBin();
  if (!bin) return false;
  const result = spawnSync(bin, [kind, "status"], { encoding: "utf8" });
  if (result.status !== 0) return false;
  const text = `${result.stdout || ""}${result.stderr || ""}`.toLowerCase();
  if (text.includes("no serve config") || text.includes("no funnel config")) return false;
  if (kind === "funnel") {
    if (text.includes("tailnet only")) return false;
    return text.includes("https://");
  }
  return text.includes("https") || text.includes("proxy") || text.includes("://");
}

async function lookupPublicA(dnsName) {
  const found = [];
  for (const server of ["8.8.8.8", "1.1.1.1", "9.9.9.9"]) {
    const resolver = new Resolver();
    resolver.setServers([server]);
    try {
      const ips = await Promise.race([
        resolver.resolve4(dnsName),
        sleep(4000).then(() => []),
      ]);
      for (const ip of ips || []) {
        if (!isPrivateOrLocalIp(ip) && !found.includes(ip)) found.push(ip);
      }
    } catch {
      /* NXDOMAIN / timeout */
    }
  }
  return found;
}

function httpsOkViaPublicIp(dnsName, ip) {
  return new Promise((resolveOk) => {
    const req = https.get(
      {
        host: ip,
        port: 443,
        path: "/api/server-info",
        servername: dnsName,
        headers: { Host: dnsName, Accept: "application/json" },
        timeout: 12000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) res.destroy();
        });
        res.on("end", () => {
          resolveOk(res.statusCode === 200 && body.includes("hasAdmin"));
        });
      },
    );
    req.on("error", () => resolveOk(false));
    req.on("timeout", () => {
      req.destroy();
      resolveOk(false);
    });
  });
}

async function probePublicAway() {
  const dnsName = tailscaleInfo().dnsName;
  if (!dnsName) return { ok: false, dnsName: "", detail: "no Tailscale DNS name" };
  const ips = await lookupPublicA(dnsName);
  if (!ips.length) return { ok: false, dnsName, detail: "not in public DNS yet" };
  for (const ip of ips.slice(0, 3)) {
    if (await httpsOkViaPublicIp(dnsName, ip)) return { ok: true, dnsName, detail: "ok" };
  }
  return { ok: false, dnsName, detail: "DNS exists, HTTPS not reachable yet" };
}

function explainPublicHttpsSetup(enableURL) {
  const dnsAdmin = "https://login.tailscale.com/admin/dns";
  const aclAdmin = "https://login.tailscale.com/admin/acls";
  note("");
  note("  Funnel on this computer is not enough. Phones without Tailscale use public DNS.");
  note("  Do this once in the Tailscale admin site (free account):");
  note("  1) DNS → HTTPS Certificates → Enable HTTPS");
  note(`     ${dnsAdmin}`);
  note("  2) Access controls → Add Funnel to policy (if you see that button)");
  note(`     ${aclAdmin}`);
  if (enableURL) {
    note("  3) Also open:");
    note(`     ${enableURL}`);
  }
  note("");
}

async function waitForPublicAway(seconds) {
  const deadline = Date.now() + seconds * 1000;
  let last = "checking";
  while (Date.now() < deadline) {
    const check = await probePublicAway();
    if (check.ok) return check;
    last = check.detail;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    note(paint(dim, `  Waiting until Away works without Tailscale on the phone (${last}, ${left}s)…`));
    await sleep(5000);
  }
  return { ok: false, dnsName: tailscaleInfo().dnsName || "", detail: last };
}

function killProcessGroup(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* gone */
    }
  }
}

function runProxyArgs(bin, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let out = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ out, error });
    };
    const onData = (chunk) => {
      const text = String(chunk);
      out += text;
      for (const line of text.split("\n")) {
        const trimmed = line.replace(/\r$/, "").trim();
        if (trimmed) note(`  ${paint(dim, trimmed)}`);
      }
      if (extractServeEnableURL(out)) {
        killProcessGroup(child);
        finish(new Error("funnel requires admin enable"));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(null);
      else finish(new Error(`exit ${code ?? "unknown"}`));
    });
    const timer = setTimeout(() => {
      killProcessGroup(child);
      finish(new Error("timed out"));
    }, timeoutMs);
  });
}

async function runProxyOnce(bin, kind, localPort, timeoutMs) {
  const withYes = await runProxyArgs(bin, [kind, "--bg", "--yes", String(localPort)], timeoutMs);
  if (!withYes.error || extractServeEnableURL(withYes.out)) return withYes;
  const lower = withYes.out.toLowerCase();
  if (lower.includes("unknown flag") || lower.includes("flag provided but not defined") || withYes.error) {
    return runProxyArgs(bin, [kind, "--bg", String(localPort)], timeoutMs);
  }
  return withYes;
}

async function turnLocalFunnelOn(bin, port, interactive) {
  if (proxyStatusEnabled("funnel")) {
    await runProxyOnce(bin, "funnel", port, 8_000);
    return "";
  }
  const first = await runProxyOnce(bin, "funnel", port, 8_000);
  if (proxyStatusEnabled("funnel")) return "";

  const enableURL = extractServeEnableURL(first.out) || "https://login.tailscale.com/admin/dns";
  explainPublicHttpsSetup(enableURL);
  if (!interactive) {
    fail(`Enable HTTPS and Funnel here first: ${enableURL} — then re-run.`);
  }
  openUrl(enableURL);
  openUrl("https://login.tailscale.com/admin/acls");
  await waitForEnter("  Press Enter after enabling HTTPS / Funnel in the browser... ");
  const second = await runProxyOnce(bin, "funnel", port, 20_000);
  if (!proxyStatusEnabled("funnel")) {
    const again = extractServeEnableURL(second.out) || enableURL;
    fail(`Funnel is still off. Open ${again}, enable it, and re-run.`);
  }
  return enableURL;
}

async function enableFunnel(port, interactive) {
  const bin = resolveTailscaleBin();
  if (!bin) fail(`Tailscale CLI not found. Install it from ${TAILSCALE_DOWNLOAD}`);

  note(paint(dim, "  Enabling public HTTPS (Tailscale Funnel)…"));
  note(paint(dim, "  Other devices only need Verbbe. Tailscale stays on this computer."));

  const enableURL = await turnLocalFunnelOn(bin, port, interactive);
  note(`  ${paint(lime, "●")}  Funnel process is on this computer`);
  note(paint(dim, "  Checking that the Away URL works from the public internet…"));

  let check = await waitForPublicAway(120);
  if (!check.ok) {
    explainPublicHttpsSetup(enableURL);
    if (!interactive) {
      fail(
        `Away is not public yet (${check.detail}). Enable HTTPS + Funnel, then re-run: verbbe start --mode tailscale`,
      );
    }
    openUrl("https://login.tailscale.com/admin/dns");
    await waitForEnter("  Press Enter after enabling HTTPS Certificates / Funnel... ");
    await runProxyOnce(bin, "funnel", port, 12_000);
    check = await waitForPublicAway(180);
  }
  if (!check.ok) {
    fail(
      `Away still is not on the public internet (${check.detail}). Phones without Tailscale cannot connect. Enable HTTPS at https://login.tailscale.com/admin/dns and re-run.`,
    );
  }
  note(`  ${paint(lime, "●")}  Away is public  ${paint(dim, `https://${check.dnsName}`)}`);
  return check;
}

function resetProxies() {
  const bin = resolveTailscaleBin();
  if (!bin) return;
  for (const kind of ["funnel", "serve"]) {
    spawnSync(bin, [kind, "reset"], { encoding: "utf8" });
  }
}

async function cmdStart(args) {
  const music = await resolveMusic(args);
  const port = Number(args.port || readEnvFile().VERBBE_PORT || DEFAULT_PORT) || DEFAULT_PORT;
  const name = args.name || readEnvFile().VERBBE_NAME || "Verbbe";
  const mode = await resolveMode(args);
  const previous = readEnvFile();
  const serverDir = findServerDir();

  if (!existsSync(music)) fail(`Music folder not found: ${music}`);

  banner();
  say(`  ${paint(dim, "music")}   ${music}`);
  say(`  ${paint(dim, "port")}    ${port}`);
  say(`  ${paint(dim, "mode")}    ${mode === "tailscale" ? "anywhere (public HTTPS, Verbbe only on the phone)" : "home Wi-Fi"}`);
  say();

  if (mode === "lan" && previous.VERBBE_FUNNEL === "1") {
    note(paint(dim, "  Turning off the public Funnel link…"));
    resetProxies();
  }

  if (mode === "tailscale") {
    await ensureTailscale(args);
    say();
  }

  writeEnv({ music, port, name, mode, funnel: false, publicAway: false });

  const existing = await probeServer(port);
  if (existing) {
    say(`  ${paint(lime, "●")}  ${existing.name || name} ${paint(dim, existing.version || "")} is already running`);
    say();
  } else if (args.native) {
    await startNative({ music, port, name, serverDir, mode, args });
    return;
  } else {
    const compose = await ensureDocker();
    ensureCompose(serverDir);
    say(paint(dim, "  Building and starting the container…"));
    say();
    run(compose.bin, [...compose.prefix, ...composeArgs(["up", "-d", "--build"])], {
      env: composeEnv(),
      failMessage: "Could not start the Verbbe container",
    });

    say(paint(dim, "  Waiting for the server…"));
    const info = await waitForServer(port);
    say();
    if (info) say(`  ${paint(lime, "●")}  ${info.name || name} ${paint(dim, info.version || "")} is up`);
    else say(`  ${paint(dim, "●")}  container is up — give it a few seconds if the page is empty`);
    say();
  }

  let funnel = false;
  let publicAway = false;
  if (mode === "tailscale") {
    const interactive = Boolean(process.stdin.isTTY) && !args.yes;
    const away = await enableFunnel(port, interactive);
    funnel = true;
    publicAway = Boolean(away?.ok);
    writeEnv({ music, port, name, mode, funnel, publicAway });
    say();
  }

  await printEndpoints(mode, port, publicAway || null);
  if (!args.noOpen) openUrl(`http://127.0.0.1:${port}`);
}

async function startNative({ music, port, name, serverDir, mode, args }) {
  if (!serverDir) {
    fail("Native mode needs the Verbbe repo (server/). Use Docker, or clone the project.");
  }
  if (!which("npm")) fail("Node/npm is missing.");

  const dataDir = join(configDir, "data");
  mkdirSync(dataDir, { recursive: true });

  if (!existsSync(join(serverDir, "node_modules"))) {
    say(paint(dim, "  npm install…"));
    run("npm", ["install"], { cwd: serverDir });
  }
  if (!existsSync(join(serverDir, "dist", "index.js"))) {
    say(paint(dim, "  npm run build…"));
    run("npm", ["run", "build"], { cwd: serverDir });
  }

  if (mode === "tailscale") {
    const interactive = Boolean(process.stdin.isTTY) && !args.yes;
    const away = await enableFunnel(port, interactive);
    writeEnv({
      music,
      port,
      name,
      mode,
      funnel: true,
      publicAway: Boolean(away?.ok),
    });
    say();
  }

  say(paint(dim, "  Starting Node server (Ctrl+C to stop)…"));
  say();
  await printEndpoints(mode, port);
  const child = spawn("node", ["dist/index.js"], {
    cwd: serverDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      MUSIC_DIR: music,
      SERVER_NAME: name,
      TRUST_PROXY: mode === "tailscale" ? "1" : "0",
    },
  });
  const stop = () => {
    if (mode === "tailscale") resetProxies();
    child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise((resolveWait, reject) => {
    child.on("exit", (code) => {
      if (code) reject(new Error(`server exited ${code}`));
      else resolveWait();
    });
  });
}

function cmdStop() {
  const saved = readEnvFile();
  if (saved.VERBBE_FUNNEL === "1" || saved.VERBBE_MODE === "tailscale") {
    note(paint(dim, "  Turning off the public Funnel link…"));
    resetProxies();
    if (saved.VERBBE_MUSIC) {
      writeEnv({
        music: saved.VERBBE_MUSIC,
        port: saved.VERBBE_PORT || DEFAULT_PORT,
        name: saved.VERBBE_NAME || "Verbbe",
        mode: saved.VERBBE_MODE || "lan",
        funnel: false,
        publicAway: false,
      });
    }
  }
  const compose = dockerCompose();
  if (compose && existsSync(composePath)) {
    run(compose.bin, [...compose.prefix, ...composeArgs(["down"])], {
      env: composeEnv(),
      allowFail: true,
    });
  } else {
    spawnSync("docker", ["rm", "-f", "verbbe"], { encoding: "utf8" });
  }
  say(paint(lime, "  stopped"));
  say(paint(dim, "  Your music files are still on disk. Start again with: verbbe start"));
}

async function cmdUninstall(args) {
  const saved = readEnvFile();
  const interactive = Boolean(process.stdin.isTTY) && !args.yes;
  note("");
  note("  This removes the Verbbe server from this computer.");
  note("  Your music folder is never deleted.");
  note("");
  note("  stop      — pause it (verbbe start brings it back)");
  note("  uninstall — stop it and remove the container");
  note("");
  let wipe = !args.keepData;
  if (interactive && !args.keepData) {
    const answer = await ask("Also delete the server library (users, playlists)? y/N", "N");
    wipe = /^y(es)?$/i.test(answer);
  }
  if (interactive) {
    const confirm = await ask("Uninstall Verbbe on this computer? y/N", "N");
    if (!/^y(es)?$/i.test(confirm)) {
      say(paint(dim, "  cancelled"));
      return;
    }
  }

  if (saved.VERBBE_FUNNEL === "1" || saved.VERBBE_MODE === "tailscale") {
    note(paint(dim, "  Turning off the public Away link…"));
    resetProxies();
  }

  const compose = dockerCompose();
  if (compose && existsSync(composePath)) {
    const extra = wipe ? ["down", "-v"] : ["down"];
    run(compose.bin, [...compose.prefix, ...composeArgs(extra)], {
      env: composeEnv(),
      allowFail: true,
    });
  } else {
    spawnSync("docker", ["rm", "-f", "verbbe"], { encoding: "utf8" });
    if (wipe) spawnSync("docker", ["volume", "rm", "-f", "verbbe_verbbe-data"], { encoding: "utf8" });
  }

  try {
    rmSync(composePath, { force: true });
  } catch {
    /* ignore */
  }
  if (wipe) {
    try {
      rmSync(join(configDir, "data"), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(envPath, { force: true });
    } catch {
      /* ignore */
    }
  }
  say(paint(lime, "  uninstalled"));
  say(paint(dim, wipe
    ? "  Server data removed. Music files on your disk were not touched."
    : "  Container removed. Server library kept — verbbe start can reuse it."));
}

async function cmdRestart(args) {
  cmdStop();
  await cmdStart(args);
}

async function cmdStatus() {
  const saved = readEnvFile();
  const port = saved.VERBBE_PORT || String(DEFAULT_PORT);
  const mode = normalizeMode(saved.VERBBE_MODE) || "lan";
  if (existsSync(composePath) && dockerCompose()) {
    const compose = requireCompose();
    run(compose.bin, [...compose.prefix, ...composeArgs(["ps"])], { env: composeEnv() });
    say();
  }
  await printEndpoints(mode, port);
}

async function cmdUrl() {
  const saved = readEnvFile();
  const port = saved.VERBBE_PORT || String(DEFAULT_PORT);
  const mode = normalizeMode(saved.VERBBE_MODE) || "lan";
  const urls = accessURLs(mode, port);
  if (mode === "tailscale") {
    say("Home (same Wi-Fi):");
    say(`  ${urls.home}`);
    const away = await probePublicAway();
    if (away.ok) {
      say("Away (anyone with Verbbe, no Tailscale on the phone):");
      say(`  ${urls.remote}`);
    } else {
      say(`Away is not public yet (${away.detail}).`);
      say("  Re-run: verbbe start --mode tailscale");
    }
    return;
  }
  say(urls.home);
}

function cmdLogs(args) {
  const compose = requireCompose();
  if (!existsSync(composePath)) fail("Server is not running. Try: verbbe start");
  const extra = args.follow ? ["logs", "-f"] : ["logs", "--tail", "200"];
  const child = spawn(compose.bin, [...compose.prefix, ...composeArgs(extra)], {
    stdio: "inherit",
    env: composeEnv(),
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function cmdOpen() {
  const port = readEnvFile().VERBBE_PORT || String(DEFAULT_PORT);
  openUrl(`http://127.0.0.1:${port}`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "help";

if (args.version || command === "version") {
  say(VERSION);
  process.exit(0);
}

if (args.help || command === "help") {
  usage();
  process.exit(0);
}

const commands = {
  start: () => cmdStart(args),
  stop: () => cmdStop(),
  off: () => cmdStop(),
  uninstall: () => cmdUninstall(args),
  remove: () => cmdUninstall(args),
  restart: () => cmdRestart(args),
  status: () => cmdStatus(),
  url: () => cmdUrl(),
  logs: () => cmdLogs(args),
  open: () => cmdOpen(),
};

if (!commands[command]) fail(`Unknown command: ${command}\n\nRun verbbe help`);

Promise.resolve(commands[command]())
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
