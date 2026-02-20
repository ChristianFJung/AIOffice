import Phaser from "phaser";

export type AgentView = {
  agentId: string;
  name?: string;
  status?: string;
  summary?: string;
  desk?: { x: number; y: number };
  position?: { x: number; y: number };
};

export type ProximityHandler = (agentId: string | null) => void;

export class OfficeScene extends Phaser.Scene {
  private player?: Phaser.Physics.Arcade.Sprite;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: { [key: string]: Phaser.Input.Keyboard.Key };
  private shiftKey?: Phaser.Input.Keyboard.Key;
  private defaultDesks = new Map<string, { x: number; y: number; flip?: boolean }>();
  private npcSprites = new Map<string, Phaser.GameObjects.Image>();
  private npcLabels = new Map<string, Phaser.GameObjects.Text>();
  private npcStatus = new Map<string, Phaser.GameObjects.Text>();
  private typingIndicators = new Map<
    string,
    { container: Phaser.GameObjects.Container; dots: Phaser.GameObjects.Arc[] }
  >();
  private proximityHandler?: ProximityHandler;
  private activeNearby: string | null = null;
  private selectedAgentId: string | null = null;
  private selectionRing?: Phaser.GameObjects.Graphics;
  private isReady = false;
  private pendingAgents: AgentView[] | null = null;
  private agentSpriteKeys = ["person-boy-a", "person-boy-b", "person-boy-c", "person-girl-d", "person-girl-e"];
  private agentSpriteById = new Map<string, string>();
  private usedSpriteKeys = new Set<string>();
  private assignedDesks = new Map<string, { x: number; y: number; flip?: boolean }>();
  private agentMeta = new Map<string, { status?: string; summary?: string }>();
  private typingJitterEnabled = true;
  private typingJitter = new Map<
    string,
    {
      baseX: number;
      baseY: number;
      offsetX: number;
      offsetY: number;
      nextAt: number;
    }
  >();
  private fallbackDesks = [
    { x: 195, y: 617 },
    { x: 189, y: 738 },
    { x: 194, y: 860 },
    { x: 645, y: 618 },
    { x: 650, y: 743 },
    { x: 373, y: 624, flip: true },
    { x: 373, y: 738, flip: true },
    { x: 365, y: 866, flip: true },
    { x: 817, y: 618, flip: true },
    { x: 821, y: 742, flip: true }
  ] as Array<{ x: number; y: number; flip?: boolean }>;
  private desiredPlayerHeight = 120;
  private desiredAgentHeight = 68;
  private inputLocked = false;
  private clockText!: Phaser.GameObjects.Text;

  constructor() {
    super("OfficeScene");
  }

  preload() {
    this.load.tilemapTiledJSON("office", "/maps/office.json");
    this.load.image("floor-tile", "/tilesets/pixel-office/floor-tile.png");
    this.load.image("office-assets", "/tilesets/pixel-office/PixelOfficeAssets.png");
    this.load.image("office-bg", "/tilesets/no-people.png");
    this.load.image("agent", "/sprites/agent.svg");
    this.load.spritesheet("boss", "/sprites/bossAllPoses.cleaned.png", {
      frameWidth: 186,
      frameHeight: 529
    });
    this.load.image("person-boy-a", "/sprites/people/BoyA.png");
    this.load.image("person-boy-b", "/sprites/people/Boyb.png");
    this.load.image("person-boy-c", "/sprites/people/Boyc.png");
    this.load.image("person-girl-d", "/sprites/people/GirlD.png");
    this.load.image("person-girl-e", "/sprites/people/Girle.png");
  }

  create() {
    const map = this.make.tilemap({ key: "office" });
    const floorTiles = map.addTilesetImage("floor-tile", "floor-tile");
    const officeTiles = map.addTilesetImage("office-assets", "office-assets");
    const floor = map.createLayer("Floor", floorTiles, 0, 0);
    const furniture = map.createLayer("Furniture", officeTiles, 0, 0);
    const walls = map.createLayer("Walls", floorTiles, 0, 0);
    walls.setCollision([1]);
    floor.setAlpha(0);
    furniture?.setAlpha(0);
    walls.setAlpha(0);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    const bg = this.add.image(0, 0, "office-bg");
    bg.setOrigin(0, 0);
    bg.setDepth(-5);
    bg.displayWidth = map.widthInPixels;
    bg.displayHeight = map.heightInPixels;

    // Real-time clock overlay (positioned over the static "12:00" in the background)
    const scaleX = map.widthInPixels / 1024;
    const scaleY = map.heightInPixels / 904;
    // Cover the entire LCD area with a dark rectangle first
    const lcdX = 472 * scaleX;
    const lcdY = 297 * scaleY;
    const lcdW = (547 - 472) * scaleX;
    const lcdH = (317 - 297) * scaleY;
    const lcdCover = this.add.rectangle(
      lcdX + lcdW / 2, lcdY + lcdH / 2, lcdW, lcdH, 0x1a1a2e
    );
    lcdCover.setDepth(-4);
    this.clockText = this.add.text(510 * scaleX, 308 * scaleY, "", {
      fontFamily: '"Courier New", monospace',
      fontSize: "18px",
      color: "#e05555",
      fontStyle: "bold",
    });
    this.clockText.setOrigin(0.5, 0.5);
    this.clockText.setDepth(-3);

    const npcLayer = map.getObjectLayer("NPCs");
    if (npcLayer) {
      for (const obj of npcLayer.objects) {
        if (!obj.name) continue;
        const x = (obj.x ?? 0) + 8;
        const y = (obj.y ?? 0) + 8;
        this.defaultDesks.set(obj.name, { x, y });
      }
    }
    if (this.defaultDesks.size === 0) {
      // Fallback desks aligned to the background scene
      this.fallbackDesks.forEach((desk, idx) => {
        this.defaultDesks.set(`desk-${idx}`, desk);
      });
    }

    if (!this.anims.exists("boss-walk-side")) {
      this.anims.create({
        key: "boss-walk-side",
        frames: this.anims.generateFrameNumbers("boss", { start: 2, end: 3 }),
        frameRate: 6,
        repeat: -1
      });
      this.anims.create({
        key: "boss-walk-front",
        frames: this.anims.generateFrameNumbers("boss", { start: 0, end: 1 }),
        frameRate: 4,
        repeat: -1
      });
      this.anims.create({
        key: "boss-idle",
        frames: [{ key: "boss", frame: 0 }],
        frameRate: 1,
        repeat: -1
      });
    }

    const player = this.physics.add.sprite(513, 484, "boss", 0);
    player.setDepth(5);
    player.setCollideWorldBounds(true);
    const scale = this.desiredPlayerHeight / 529;
    player.setScale(scale);
    player.setOrigin(0.5, 1);
    player.setSize(10, 12);
    player.setOffset(3, 2);
    this.player = player;
    this.physics.add.collider(player, walls);

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasdKeys = this.input.keyboard?.addKeys("W,A,S,D") as {
      [key: string]: Phaser.Input.Keyboard.Key;
    };
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(player, true, 0.08, 0.08);
    this.cameras.main.setZoom(2);
    this.cameras.main.roundPixels = true;

    floor.setDepth(0);
    furniture?.setDepth(1);
    walls.setDepth(2);
    this.isReady = true;
    if (this.pendingAgents) {
      this.syncAgents(this.pendingAgents);
      this.pendingAgents = null;
    }

    this.input.keyboard?.on("keydown-SPACE", () => {
      this.inputLocked = false;
    });
  }

  setProximityHandler(handler: ProximityHandler) {
    this.proximityHandler = handler;
  }

  lockInput(locked: boolean) {
    this.inputLocked = locked;
    if (this.input.keyboard) {
      this.input.keyboard.enabled = !locked;
      // Reset all keys to prevent stuck keys when toggling input lock
      this.input.keyboard.resetKeys();
    }
  }

  setTypingJitterEnabled(enabled: boolean) {
    this.typingJitterEnabled = enabled;
  }

  setSelectedAgent(agentId: string | null) {
    this.selectedAgentId = agentId;
    // Clean up previous indicator
    if (this.selectionRing) {
      this.selectionRing.destroy();
      this.selectionRing = undefined;
    }
    for (const [id, sprite] of this.npcSprites) {
      if (id === agentId) {
        sprite.setTint(0xffd166);
        // Create a small downward-pointing triangle above the agent
        const gfx = this.add.graphics();
        gfx.setDepth(10);
        this.selectionRing = gfx;
      } else {
        sprite.clearTint();
      }
    }
  }

  syncAgents(agents: AgentView[]) {
    if (!this.isReady) {
      this.pendingAgents = agents;
      return;
    }
    const taken = new Set<string>();
    agents.forEach((agent, index) => {
      const assignedDesk = this.assignDesk(agent, index);
      // Desk-anchored spawn: prefer assigned desk regardless of agent.position
      const pos = assignedDesk ?? agent.desk ?? agent.position ?? { x: 64 + index * 18, y: 64 };
      let sprite = this.npcSprites.get(agent.agentId);
      if (!sprite) {
        let spriteKey = this.agentSpriteById.get(agent.agentId);
        if (!spriteKey) {
          // Cycle through all sprites before repeating
          const availableKeys = this.agentSpriteKeys.filter(k => !this.usedSpriteKeys.has(k));
          if (availableKeys.length === 0) {
            // All sprites used, reset and start over
            this.usedSpriteKeys.clear();
            spriteKey = this.agentSpriteKeys[Math.floor(Math.random() * this.agentSpriteKeys.length)];
          } else {
            // Pick randomly from unused sprites
            spriteKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
          }
          this.usedSpriteKeys.add(spriteKey);
          this.agentSpriteById.set(agent.agentId, spriteKey);
        }
        sprite = this.add.image(pos.x, pos.y, spriteKey);
        const spriteTexture = this.textures.get(spriteKey);
        const spriteSource = spriteTexture.getSourceImage() as HTMLImageElement;
        if (spriteSource?.height) {
          const scale = this.desiredAgentHeight / spriteSource.height;
          sprite.setScale(scale);
        }
        sprite.setOrigin(0.5, 1);
        if (assignedDesk?.flip) {
          sprite.setFlipX(true);
        }
        sprite.setDepth(4);
        this.npcSprites.set(agent.agentId, sprite);
        const labelText = (agent.name ?? agent.agentId).slice(0, 14);
        const label = this.add.text(pos.x, pos.y - 30, labelText, {
          fontSize: "10px",
          color: "#f1eee6"
        });
        label.setBackgroundColor("rgba(0,0,0,0.6)");
        label.setPadding(3, 2, 3, 2);
        label.setStroke("#000000", 2);
        label.setOrigin(0.5, 1);
        label.setDepth(5);
        this.npcLabels.set(agent.agentId, label);

        const status = this.add.text(pos.x, pos.y - 44, "", {
          fontSize: "9px",
          color: "#d9a441"
        });
        status.setBackgroundColor("rgba(0,0,0,0.5)");
        status.setPadding(3, 2, 3, 2);
        status.setStroke("#000000", 2);
        status.setOrigin(0.5, 1);
        status.setDepth(5);
        this.npcStatus.set(agent.agentId, status);
      }
      if (!this.typingIndicators.has(agent.agentId)) {
        const dot1 = this.add.circle(0, 0, 2, 0xffffff);
        const dot2 = this.add.circle(6, 0, 2, 0xffffff);
        const dot3 = this.add.circle(12, 0, 2, 0xffffff);
        const container = this.add.container(pos.x, pos.y - 10, [dot1, dot2, dot3]);
        container.setDepth(6);
        container.setVisible(false);
        this.typingIndicators.set(agent.agentId, { container, dots: [dot1, dot2, dot3] });
      }
      sprite.setPosition(pos.x, pos.y);
      const label = this.npcLabels.get(agent.agentId);
      if (label) {
        const offset = sprite ? sprite.displayHeight + 6 : 22;
        label.setPosition(pos.x, pos.y - offset);
        label.setText((agent.name ?? agent.agentId).slice(0, 14));
      }
      const status = this.npcStatus.get(agent.agentId);
      if (status) {
        const summary = agent.summary ?? "";
        const trimmed = summary.length > 20 ? `${summary.slice(0, 20)}…` : summary;
        const statusText = agent.status ? `${agent.status}${trimmed ? `: ${trimmed}` : ""}` : "";
        status.setText(statusText);
        status.setColor(this.getStatusColor(agent.status));
        const offset = (sprite ? sprite.displayHeight + 20 : 38);
        status.setPosition(pos.x, pos.y - offset);
      }
      const typing = this.typingIndicators.get(agent.agentId);
      if (typing) {
        const offset = sprite ? sprite.displayHeight - 6 : 14;
        typing.container.setPosition(pos.x - 6, pos.y - offset);
      }
      const jitter = this.typingJitter.get(agent.agentId) ?? {
        baseX: pos.x,
        baseY: pos.y,
        offsetX: 0,
        offsetY: 0,
        nextAt: 0
      };
      jitter.baseX = pos.x;
      jitter.baseY = pos.y;
      this.typingJitter.set(agent.agentId, jitter);
      this.agentMeta.set(agent.agentId, { status: agent.status, summary: agent.summary });
      taken.add(agent.agentId);
    });

    for (const [id, sprite] of this.npcSprites) {
      if (!taken.has(id)) {
        sprite.destroy();
        this.npcSprites.delete(id);
        // Release sprite key back to pool
        const spriteKey = this.agentSpriteById.get(id);
        if (spriteKey) {
          this.usedSpriteKeys.delete(spriteKey);
        }
        this.agentSpriteById.delete(id);
        this.agentMeta.delete(id);
        this.assignedDesks.delete(id);
        this.typingJitter.delete(id);
        const typing = this.typingIndicators.get(id);
        typing?.container.destroy(true);
        this.typingIndicators.delete(id);
        this.npcLabels.get(id)?.destroy();
        this.npcLabels.delete(id);
        this.npcStatus.get(id)?.destroy();
        this.npcStatus.delete(id);
      }
    }
  }

  update() {
    // Update clock every frame (text change is cheap; only redraws when string changes)
    const now = new Date();
    let h = now.getHours() % 12;
    if (h === 0) h = 12;
    const m = now.getMinutes().toString().padStart(2, "0");
    const timeStr = `${h}:${m}`;
    if (this.clockText && this.clockText.text !== timeStr) {
      this.clockText.setText(timeStr);
    }

    if (!this.player) return;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (this.inputLocked) {
      body.setVelocity(0);
      this.updatePlayerAnimation(body);
      this.updateTypingIndicators();
      return;
    }
    if (!this.cursors || !this.wasdKeys) return;
    const speed = this.shiftKey?.isDown ? 130 : 80;
    body.setVelocity(0);

    const up = this.cursors.up?.isDown || this.wasdKeys.W.isDown;
    const down = this.cursors.down?.isDown || this.wasdKeys.S.isDown;
    const left = this.cursors.left?.isDown || this.wasdKeys.A.isDown;
    const right = this.cursors.right?.isDown || this.wasdKeys.D.isDown;

    if (up) body.setVelocityY(-speed);
    if (down) body.setVelocityY(speed);
    if (left) body.setVelocityX(-speed);
    if (right) body.setVelocityX(speed);
    body.velocity.normalize().scale(speed);

    this.updatePlayerAnimation(body);
    this.checkProximity();
    this.updateTypingIndicators();
  }

  private assignDesk(agent: AgentView, index: number) {
    const existing = this.assignedDesks.get(agent.agentId);
    if (existing) return existing;
    const namedDesk = this.defaultDesks.get(agent.agentId);
    if (namedDesk) {
      this.assignedDesks.set(agent.agentId, namedDesk);
      return namedDesk;
    }
    const used = new Set(
      Array.from(this.assignedDesks.values()).map((desk) => `${desk.x},${desk.y}`)
    );
    const available = this.fallbackDesks.find((desk) => !used.has(`${desk.x},${desk.y}`));
    const chosen =
      available ?? this.fallbackDesks[index % this.fallbackDesks.length];
    this.assignedDesks.set(agent.agentId, chosen);
    return chosen;
  }

  private updateTypingIndicators() {
    const now = this.time.now;
    const phase = Math.floor(now / 200) % 3;
    for (const [id, typing] of this.typingIndicators) {
      const meta = this.agentMeta.get(id);
      const sprite = this.npcSprites.get(id);
      let jitter = this.typingJitter.get(id);
      if (!jitter) {
        jitter = {
          baseX: sprite?.x ?? 0,
          baseY: sprite?.y ?? 0,
          offsetX: 0,
          offsetY: 0,
          nextAt: now + Phaser.Math.Between(200, 600)
        };
        this.typingJitter.set(id, jitter);
      }

      if (!meta || (meta.status !== "working" && meta.status !== "thinking") || !this.typingJitterEnabled) {
        typing.container.setVisible(false);
        if (sprite) {
          // Clear thinking tint (but preserve selected tint)
          if (id !== this.selectedAgentId) sprite.clearTint();
          jitter.offsetX = 0;
          jitter.offsetY = 0;
          jitter.nextAt = now + Phaser.Math.Between(200, 600);
          sprite.setPosition(jitter.baseX, jitter.baseY);
        }
        continue;
      }
      typing.container.setVisible(true);
      typing.dots.forEach((dot, idx) => {
        dot.setAlpha(idx === phase ? 1 : 0.3);
      });

      if (sprite && now >= jitter.nextAt) {
        if (jitter.offsetX !== 0 || jitter.offsetY !== 0) {
          jitter.offsetX = 0;
          jitter.offsetY = 0;
          jitter.nextAt = now + Phaser.Math.Between(220, 520);
        } else {
          const horizontal = Math.random() < 0.7;
          const dir = Math.random() < 0.5 ? -1 : 1;
          jitter.offsetX = horizontal ? dir : 0;
          jitter.offsetY = horizontal ? 0 : dir;
          jitter.nextAt = now + Phaser.Math.Between(70, 140);
        }
      }
      if (sprite) {
        sprite.setPosition(jitter.baseX + jitter.offsetX, jitter.baseY + jitter.offsetY);
      }
    }

    // Update selection arrow — bouncing triangle above selected agent
    if (this.selectionRing && this.selectedAgentId) {
      const sprite = this.npcSprites.get(this.selectedAgentId);
      if (sprite) {
        const bounce = Math.sin(now / 250) * 3;
        const x = sprite.x;
        const y = sprite.y - sprite.displayHeight - 28 + bounce;
        this.selectionRing.clear();
        this.selectionRing.fillStyle(0xffd166, 1);
        this.selectionRing.fillTriangle(x - 5, y, x + 5, y, x, y + 6);
      }
    }
  }

  private updatePlayerAnimation(body: Phaser.Physics.Arcade.Body) {
    if (!this.player) return;
    const moving = Math.abs(body.velocity.x) > 1 || Math.abs(body.velocity.y) > 1;
    if (moving) {
      if (Math.abs(body.velocity.x) >= Math.abs(body.velocity.y)) {
        if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== "boss-walk-side") {
          this.player.anims.play("boss-walk-side", true);
        }
        if (body.velocity.x < -1) {
          this.player.setFlipX(true);
        } else if (body.velocity.x > 1) {
          this.player.setFlipX(false);
        }
      } else {
        if (!this.player.anims.isPlaying || this.player.anims.currentAnim?.key !== "boss-walk-front") {
          this.player.anims.play("boss-walk-front", true);
        }
        this.player.setFlipX(false);
      }
    } else {
      this.player.anims.play("boss-idle", true);
    }
  }

  private checkProximity() {
    if (!this.player) return;
    let nearest: { id: string; dist: number } | null = null;
    for (const [id, sprite] of this.npcSprites) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sprite.x, sprite.y);
      const threshold = Math.max(
        40,
        (this.player.displayHeight + sprite.displayHeight) * 0.5
      );
      if (dist < threshold && (!nearest || dist < nearest.dist)) {
        nearest = { id, dist };
      }
    }
    const nextId = nearest?.id ?? null;
    if (nextId !== this.activeNearby) {
      this.activeNearby = nextId;
      if (this.proximityHandler) this.proximityHandler(nextId);
    }
  }

  private getStatusColor(status?: string) {
    switch (status) {
      case "thinking":
        return "#d9a441";
      case "error":
        return "#e05d5d";
      case "replied":
        return "#4fb0ff";
      case "available":
        return "#60d394";
      default:
        return "#f1eee6";
    }
  }
}
