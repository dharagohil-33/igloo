export class HUDController {
  constructor(options) {
    this.onProgressChange = options.onProgressChange || (() => {});

    this.targetProgress = 0.0;
    this.currentProgress = 0.0;
    this.isDraggingTracker = false;

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    this.trackerLineBg = document.getElementById('tracker-line-bg');
    this.trackerLineFill = document.getElementById('tracker-line-fill');
    this.scrollPercentBadge = document.getElementById('scroll-percent-badge');
    this.scrollPrompt = document.getElementById('scroll-prompt');
    this.scrollTracker = document.getElementById('scroll-tracker');
  }

  bindEvents() {
    // 1. Natural window scroll event (driven by mouse scroll wheel or touchpad)
    window.addEventListener('scroll', () => {
      if (this.isDraggingTracker) return;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        const ratio = Math.max(0.0, Math.min(1.0, window.scrollY / maxScroll));
        this.setTargetProgress(ratio);
      }
    });

    // 2. Direct mouse wheel event handler for fast smooth scroll response
    window.addEventListener('wheel', (e) => {
      // Mouse scroll wheel adjusts progress directly
      const delta = e.deltaY * 0.0015;
      const newProgress = Math.max(0.0, Math.min(1.0, this.targetProgress + delta));
      this.setTargetProgress(newProgress);

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll > 0) {
        window.scrollTo({
          top: newProgress * maxScroll,
          behavior: 'auto'
        });
      }
    }, { passive: true });

    // 3. Interactive Mouse Scrubbing on vertical right scrollbar tracker
    if (this.scrollTracker) {
      const handleTrackerScrub = (e) => {
        if (!this.trackerLineBg) return;
        const rect = this.trackerLineBg.getBoundingClientRect();
        const offsetY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        const progress = offsetY / rect.height;

        this.setTargetProgress(progress);
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        if (maxScroll > 0) {
          window.scrollTo({ top: progress * maxScroll, behavior: 'auto' });
        }
      };

      this.scrollTracker.addEventListener('mousedown', (e) => {
        this.isDraggingTracker = true;
        handleTrackerScrub(e);
      });

      window.addEventListener('mousemove', (e) => {
        if (this.isDraggingTracker) {
          handleTrackerScrub(e);
        }
      });

      window.addEventListener('mouseup', () => {
        this.isDraggingTracker = false;
      });
    }
  }

  setTargetProgress(val) {
    this.targetProgress = Math.max(0.0, Math.min(1.0, val));
  }

  update(deltaTime) {
    // Inertial lerp for smooth scroll animation
    this.currentProgress += (this.targetProgress - this.currentProgress) * 0.12;

    if (Math.abs(this.targetProgress - this.currentProgress) < 0.0001) {
      this.currentProgress = this.targetProgress;
    }

    const percentInt = Math.floor(this.currentProgress * 100);
    const padded = percentInt < 10 ? `0${percentInt}` : `${percentInt}`;

    // Update UI elements
    if (this.trackerLineFill) this.trackerLineFill.style.height = `${percentInt}%`;
    if (this.scrollPercentBadge) this.scrollPercentBadge.innerText = `${padded}%`;

    // Fade out scroll prompt once scrolling starts
    if (this.scrollPrompt) {
      if (this.currentProgress > 0.03) {
        this.scrollPrompt.classList.add('fade-out');
      } else {
        this.scrollPrompt.classList.remove('fade-out');
      }
    }

    // Notify main renderer
    this.onProgressChange(this.currentProgress);
  }
}
