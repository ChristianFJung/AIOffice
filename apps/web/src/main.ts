import Phaser from "phaser";
import { marked } from "marked";
import { OfficeScene, type AgentView } from "./game";
import { EventEnvelopeSchema, validatePayload, type EventEnvelope } from "@office/shared";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,  // Convert \n to <br>
  gfm: true,     // GitHub Flavored Markdown
});

const SERVER_URL = "http://localhost:3003";
const WS_URL = "ws://localhost:3003/ws";

const scene = new OfficeScene();
const TYPING_JITTER_ENABLED = true;
scene.setTypingJitterEnabled(TYPING_JITTER_ENABLED);

const sidebarWidth = 360;
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-container",
  width: window.innerWidth - sidebarWidth,
  height: window.innerHeight,
  backgroundColor: "#1b1c1c",
  pixelArt: true,
  antialias: false,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false,
      roundPixels: true
    }
  },
  scene
};

const game = new Phaser.Game(config);

window.addEventListener("resize", () => {
  game.scale.resize(window.innerWidth - sidebarWidth, window.innerHeight);
});

const uiPanel = document.getElementById("ui-panel") as HTMLDivElement;
const panelTitle = document.getElementById("panel-title") as HTMLSpanElement;
const panelProvider = document.getElementById("panel-provider") as HTMLSpanElement;
const panelStatus = document.getElementById("panel-status") as HTMLDivElement;
const panelMessages = document.getElementById("panel-messages") as HTMLDivElement;
const panelEmpty = document.getElementById("panel-empty") as HTMLDivElement;
const panelClose = document.getElementById("panel-close") as HTMLButtonElement;
const panelNewChat = document.getElementById("panel-new-chat") as HTMLButtonElement;
const panelDelete = document.getElementById("panel-delete") as HTMLButtonElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const chatSend = document.getElementById("chat-send") as HTMLButtonElement;
const topBanner = document.getElementById("top-banner") as HTMLDivElement;
const topBannerText = document.getElementById("top-banner-text") as HTMLSpanElement;
const topBannerClose = document.getElementById("top-banner-close") as HTMLButtonElement;
const audioEl = document.getElementById("bgm") as HTMLAudioElement;
const audioPlay = document.getElementById("audio-play") as HTMLButtonElement;
const audioPause = document.getElementById("audio-pause") as HTMLButtonElement;

let agents: AgentView[] = [];
let tasks: Array<{ taskId: string; agentId: string; title: string; details?: string }> = [];
let currentAgentId: string | null = null;
let nearbyAgentId: string | null = null;
let knownAgents = new Set<string>();
let bannerTimeout: number | undefined;
let dismissedBanners = new Set<string>();
let activeBannerAgentId: string | null = null;

const statusClasses = [
  "status-available",
  "status-thinking",
  "status-replied",
  "status-error"
];

const statusColors: Record<string, string> = {
  available: "#60d394",
  thinking: "#d9a441",
  replied: "#4fb0ff",
  error: "#e05d5d"
};

function setPanelStatusClass(status?: string) {
  console.log("Setting status class:", status);
  panelStatus.classList.remove(...statusClasses);
  if (status) {
    panelStatus.classList.add(`status-${status}`);
    // Set color directly as backup
    panelStatus.style.color = statusColors[status] || "";
  } else {
    panelStatus.style.color = "";
  }
}

function hideBanner() {
  if (!topBanner) return;
  activeBannerAgentId = null;
  topBanner.classList.remove("show");
  window.setTimeout(() => {
    topBanner.classList.add("hidden");
  }, 300);
}

function showBanner(message: string, agentId?: string) {
  if (!topBanner) return;
  if (agentId && dismissedBanners.has(agentId)) return;
  activeBannerAgentId = agentId ?? null;
  topBannerText.textContent = message;
  topBanner.classList.remove("hidden");
  requestAnimationFrame(() => topBanner.classList.add("show"));
  if (bannerTimeout) window.clearTimeout(bannerTimeout);
  bannerTimeout = window.setTimeout(() => {
    hideBanner();
  }, 15000);
}

topBannerClose.addEventListener("click", () => {
  if (bannerTimeout) window.clearTimeout(bannerTimeout);
  if (activeBannerAgentId) dismissedBanners.add(activeBannerAgentId);
  hideBanner();
});

function attemptAutoPlay() {
  if (!audioEl) return;
  audioEl.loop = false;
  audioEl.play().then(() => setAudioState(true)).catch(() => null);
}

audioPlay.addEventListener("click", () => {
  audioEl.play().then(() => setAudioState(true)).catch(() => null);
});

audioPause.addEventListener("click", () => {
  audioEl.pause();
  setAudioState(false);
});

attemptAutoPlay();

function setAudioState(isPlaying: boolean) {
  audioPlay.classList.toggle("active", isPlaying);
  audioPause.classList.toggle("active", !isPlaying);
}

audioEl.addEventListener("ended", () => setAudioState(false));

const resumeAudio = () => {
  attemptAutoPlay();
  window.removeEventListener("pointerdown", resumeAudio);
  window.removeEventListener("keydown", resumeAudio);
};
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);

function renderPanel() {
  if (!currentAgentId) {
    panelTitle.textContent = "Chat";
    panelProvider.textContent = "";
    panelProvider.className = "panel-provider";
    panelStatus.textContent = "Not active";
    setPanelStatusClass(undefined);
    panelEmpty.classList.remove("hidden");
    panelMessages.innerHTML = "";
    chatInput.value = "";
    chatInput.disabled = true;
    chatSend.disabled = true;
    panelNewChat.style.display = "none";
    panelDelete.style.display = "none";
    scene.setSelectedAgent(null);
    return;
  }

  const agent = agents.find((a) => a.agentId === currentAgentId);
  if (!agent) return;

  panelEmpty.classList.add("hidden");
  panelTitle.textContent = agent.name ?? agent.agentId;

  // Show provider
  const cliType = (agent as any).cliType;
  if (cliType === "claude-code") {
    panelProvider.textContent = "Claude";
    panelProvider.className = "panel-provider claude";
  } else if (cliType === "copilot-cli") {
    panelProvider.textContent = "Copilot";
    panelProvider.className = "panel-provider copilot";
  } else {
    panelProvider.textContent = "";
    panelProvider.className = "panel-provider";
  }

  panelStatus.textContent = agent.status ?? "available";
  setPanelStatusClass(agent.status ?? "available");
  chatInput.disabled = false;
  chatSend.disabled = false;
  panelNewChat.style.display = "flex";
  panelDelete.style.display = "flex";

  panelMessages.innerHTML = "";
  const messages = (agent as any).messages ?? [];
  messages.slice(-20).forEach((msg: any) => {
    const div = document.createElement("div");
    const channel = msg.channel as string;
    if (channel === "task") div.className = "panel-message you";
    else if (channel === "reply") div.className = "panel-message them";
    else div.className = "panel-message meta";

    // Handle collapsible messages
    if (msg.collapsible) {
      div.classList.add("collapsible", "collapsed");
      const toggle = document.createElement("span");
      toggle.className = "collapse-toggle";
      toggle.textContent = "[+]";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCollapsed = div.classList.toggle("collapsed");
        toggle.textContent = isCollapsed ? "[+]" : "[-]";
      });
      div.appendChild(toggle);
      const content = document.createElement("span");
      content.className = "collapse-content";
      content.innerHTML = marked.parse(msg.text) as string;
      div.appendChild(content);
    } else {
      div.innerHTML = marked.parse(msg.text) as string;
    }

    panelMessages.appendChild(div);
  });

  // Auto-scroll to bottom
  panelMessages.scrollTop = panelMessages.scrollHeight;

  scene.setSelectedAgent(currentAgentId);
}

function openPanel(agentId: string, deferFocus = false) {
  currentAgentId = agentId;
  renderPanel();
  if (deferFocus) {
    setTimeout(() => chatInput.focus(), 0);
  } else {
    chatInput.focus();
  }
  scene.lockInput(true);
  const agent = agents.find((a) => a.agentId === agentId);
  // Mark as "available" when user opens chat (they've seen the reply)
  if (agent?.status === "replied") {
    fetch(`${SERVER_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.status",
        agentId,
        timestamp: new Date().toISOString(),
        payload: {
          status: "available",
          summary: "Ready"
        }
      })
    }).catch(() => null);
  }
}

function closePanel() {
  currentAgentId = null;
  renderPanel();
  scene.lockInput(false);
}

panelClose.addEventListener("click", () => closePanel());

// New Chat button - resets conversation
panelNewChat.addEventListener("click", async () => {
  if (!currentAgentId) return;
  if (!confirm("Start a new conversation? This will clear the chat history.")) return;

  try {
    await fetch(`${SERVER_URL}/agents/${currentAgentId}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "reset" })
    });
  } catch (error) {
    console.error("Failed to reset conversation:", error);
  }
});

// Delete button - removes agent entirely
panelDelete.addEventListener("click", async () => {
  if (!currentAgentId) return;
  const agent = agents.find((a) => a.agentId === currentAgentId);
  const name = agent?.name ?? currentAgentId;
  if (!confirm(`Delete "${name}"? This will stop the agent process.`)) return;

  try {
    await fetch(`${SERVER_URL}/agents/${currentAgentId}`, {
      method: "DELETE"
    });
    closePanel();
  } catch (error) {
    console.error("Failed to delete agent:", error);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePanel();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const isTyping =
    active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (isTyping) {
    return;
  }
  if (currentAgentId && event.code === "Space") {
    event.preventDefault();
    closePanel();
    return;
  }
  if (event.key.toLowerCase() === "e" && nearbyAgentId) {
    event.preventDefault();
    if (currentAgentId === nearbyAgentId) {
      closePanel();
    } else {
      openPanel(nearbyAgentId, true);
    }
  }

  // Number keys 1-9 to jump to agents
  const num = parseInt(event.key);
  if (num >= 1 && num <= 9 && agents.length > 0) {
    const index = num - 1;
    if (index < agents.length) {
      event.preventDefault();
      openPanel(agents[index].agentId, true);
    }
  }
});

chatSend.addEventListener("click", async () => {
  if (!currentAgentId || !chatInput.value.trim()) return;
  const payload = {
    type: "agent.message",
    agentId: currentAgentId,
    timestamp: new Date().toISOString(),
    payload: { text: chatInput.value.trim(), channel: "task" }
  };
  await fetch(`${SERVER_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  chatInput.value = "";
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    event.stopPropagation();
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatSend.click();
  }
});

scene.setProximityHandler((agentId) => {
  nearbyAgentId = agentId;
});

function applyEvent(event: EventEnvelope) {
  if (event.type === "snapshot") {
    const payload = event.payload as any;
    const prevAgents = new Set(knownAgents);
    agents = payload.agents ?? [];
    knownAgents = new Set(agents.map((agent) => agent.agentId));
    const newcomer = agents.find(
      (agent) => !prevAgents.has(agent.agentId) && !dismissedBanners.has(agent.agentId)
    );
    if (newcomer) {
      showBanner(`Welcome ${newcomer.name ?? newcomer.agentId}!`, newcomer.agentId);
    }
    tasks = payload.tasks ?? [];
    scene.syncAgents(agents);
    renderPanel();
    return;
  }

  if (event.type === "agent.status") {
    const payload = validatePayload(event.type, event.payload) as any;
    const agent = agents.find((a) => a.agentId === event.agentId);
    if (agent) {
      agent.status = payload.status;
      agent.summary = payload.summary;
    }
  }

  if (event.type === "agent.message") {
    const payload = validatePayload(event.type, event.payload) as any;
    const agent = agents.find((a) => a.agentId === event.agentId);
    if (agent) {
      (agent as any).messages = (agent as any).messages ?? [];
      (agent as any).messages.push({
        text: payload.text,
        channel: payload.channel,
        timestamp: event.timestamp,
        collapsible: payload.collapsible ?? false
      });
      (agent as any).messages = (agent as any).messages.slice(-20);
    }
  }

  if (event.type === "agent.position") {
    const payload = validatePayload(event.type, event.payload) as any;
    const agent = agents.find((a) => a.agentId === event.agentId);
    if (agent) {
      agent.position = payload;
    }
  }

  if (event.type === "task.assign") {
    const payload = validatePayload(event.type, event.payload) as any;
    tasks.push({
      taskId: payload.taskId,
      agentId: event.agentId,
      title: payload.title,
      details: payload.details
    });
  }

  scene.syncAgents(agents);
  renderPanel();
}

function connectWS() {
  const socket = new WebSocket(WS_URL);

  socket.addEventListener("message", (event) => {
    try {
      const parsed = EventEnvelopeSchema.safeParse(JSON.parse(event.data));
      if (parsed.success) {
        applyEvent(parsed.data);
      }
    } catch (error) {
      console.warn("Failed to parse WS event", error);
    }
  });

  socket.addEventListener("close", () => {
    setTimeout(connectWS, 1500);
  });
}

connectWS();

// ============ Add Agent Modal ============
const addAgentBtn = document.getElementById("add-agent-btn") as HTMLButtonElement;
const addAgentModal = document.getElementById("add-agent-modal") as HTMLDivElement;
const modalClose = document.getElementById("modal-close") as HTMLButtonElement;
const createAgentBtn = document.getElementById("create-agent-btn") as HTMLButtonElement;
const agentNameInput = document.getElementById("agent-name") as HTMLInputElement;
const agentCliSelect = document.getElementById("agent-cli") as HTMLSelectElement;
const agentDirInput = document.getElementById("agent-dir") as HTMLInputElement;
const agentPersonalityInput = document.getElementById("agent-personality") as HTMLInputElement;
const agentCommandDiv = document.getElementById("agent-command") as HTMLDivElement;
const agentCommandText = document.getElementById("agent-command-text") as HTMLElement;

// Random name generator
const adjectives = ["Swift", "Clever", "Brave", "Calm", "Eager", "Fancy", "Jolly", "Lucky", "Noble", "Quick"];
const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Lion", "Tiger", "Panda", "Raven", "Coder"];
function randomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

function randomDesk(): { x: number; y: number } {
  const desks = [
    { x: 195, y: 617 }, { x: 645, y: 618 }, { x: 195, y: 450 },
    { x: 645, y: 450 }, { x: 420, y: 530 }, { x: 300, y: 350 },
  ];
  const base = desks[Math.floor(Math.random() * desks.length)];
  return {
    x: base.x + Math.floor(Math.random() * 60) - 30,
    y: base.y + Math.floor(Math.random() * 60) - 30,
  };
}

addAgentBtn.addEventListener("click", () => {
  addAgentModal.classList.remove("hidden");
  agentNameInput.value = "";
  agentDirInput.value = "";
  agentPersonalityInput.value = "";
  agentCommandDiv.classList.add("hidden");
  scene.lockInput(true);
});

modalClose.addEventListener("click", () => {
  addAgentModal.classList.add("hidden");
  scene.lockInput(false);
});

addAgentModal.addEventListener("click", (e) => {
  if (e.target === addAgentModal) {
    addAgentModal.classList.add("hidden");
    scene.lockInput(false);
  }
});

createAgentBtn.addEventListener("click", async () => {
  const name = agentNameInput.value.trim() || randomName();
  const cliType = agentCliSelect.value;
  const dir = agentDirInput.value.trim();
  const personality = agentPersonalityInput.value.trim();

  if (!dir) {
    alert("Please enter a working directory path");
    return;
  }

  // Spawn agent via server
  try {
    createAgentBtn.textContent = "Starting...";
    createAgentBtn.disabled = true;

    const response = await fetch(`${SERVER_URL}/agents/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        cliType,
        workingDirectory: dir,
        personality: personality || undefined,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      agentCommandText.textContent = `✅ Agent "${name}" is starting in ${dir}`;
      agentCommandDiv.classList.remove("hidden");

      createAgentBtn.textContent = "Agent Started!";
      setTimeout(() => {
        createAgentBtn.textContent = "Create Agent";
        createAgentBtn.disabled = false;
        // Close modal after success
        addAgentModal.classList.add("hidden");
        scene.lockInput(false);
      }, 1500);
    } else {
      throw new Error(result.error || "Failed to spawn agent");
    }

  } catch (error) {
    console.error("Failed to spawn agent:", error);
    alert(`Failed to spawn agent: ${error}`);
    createAgentBtn.textContent = "Create Agent";
    createAgentBtn.disabled = false;
  }
});
