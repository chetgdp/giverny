export type WatchdogCallback = (label: string, inactivityMs: number) => void;

/** Deadline-based inactivity watchdog shared by streaming backends. */
export class ProcessWatchdog {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private deadline = 0;
    private paused = false;
    private stopped = false;
    private lastLabel = "start";

    constructor(
        private readonly timeoutMs: number,
        private readonly onTimeout: WatchdogCallback,
    ) {}

    activity(label: string): void {
        if (this.stopped) return;
        this.lastLabel = label;
        if (!this.paused) this.setDeadline(this.timeoutMs);
    }

    defer(delayMs: number, label: string): void {
        if (this.stopped) return;
        this.lastLabel = label;
        if (!this.paused) {
            this.setDeadline(Math.max(0, delayMs) + this.timeoutMs);
        }
    }

    suspend(): void {
        if (this.stopped || this.paused) return;
        this.paused = true;
        this.clear();
    }

    resume(): void {
        if (this.stopped || !this.paused) return;
        this.paused = false;
        this.setDeadline(this.timeoutMs);
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        this.clear();
    }

    private setDeadline(delayMs: number): void {
        if (this.timeoutMs <= 0 || delayMs <= 0) return;
        this.deadline = Date.now() + delayMs;
        if (this.timer === undefined) {
            this.timer = setTimeout(() => this.fire(), delayMs);
        }
    }

    private fire(): void {
        this.timer = undefined;
        if (this.stopped || this.paused || this.timeoutMs <= 0) return;
        const remaining = this.deadline - Date.now();
        if (remaining > 0) {
            this.timer = setTimeout(() => this.fire(), remaining);
            return;
        }
        this.onTimeout(this.lastLabel, this.timeoutMs);
    }

    private clear(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
