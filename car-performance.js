/**
 * APEX - Car Performance Section Module
 * Follows the Session Analysis design language & telemetry architecture.
 */

export class CarPerformanceView {
  constructor(containerId = 'car-performance') {
    this.container = document.getElementById(containerId);
    this.currentMode = 'overview'; // 'overview' | 'cornering' | 'straight' | 'braking'
    this.carA = null;
    this.carB = null;
    this.sessionData = null;
  }

  /**
   * Initializes the view with session and telemetry references
   */
  init(sessionData) {
    this.sessionData = sessionData;
    if (!this.container) return;
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <section class="car-performance-section">
        <!-- Top Navigation / Controls Bar -->
        <header class="perf-header-bar">
          <div class="perf-title-group">
            <h2>Car Performance Profiler</h2>
            <span class="perf-badge">Dynamic Telemetry</span>
          </div>

          <!-- Segmented View Toggle -->
          <div class="perf-segmented-control" role="tablist">
            <button class="perf-segment-btn ${this.currentMode === 'overview' ? 'active' : ''}" data-mode="overview">Overview</button>
            <button class="perf-segment-btn ${this.currentMode === 'cornering' ? 'active' : ''}" data-mode="cornering">Cornering Speed</button>
            <button class="perf-segment-btn ${this.currentMode === 'straight' ? 'active' : ''}" data-mode="straight">Straight & DRS</button>
            <button class="perf-segment-btn ${this.currentMode === 'braking' ? 'active' : ''}" data-mode="braking">Braking Zones</button>
          </div>
        </header>

        <!-- Driver / Car Comparison Bar -->
        <div class="perf-comparison-bar">
          <div class="perf-driver-card">
            <div class="perf-driver-accent" style="background: #3671c6;"></div>
            <div class="perf-driver-info">
              <span class="perf-driver-name">Max Verstappen</span>
              <span class="perf-driver-sub">Red Bull Racing • RB20</span>
            </div>
          </div>

          <div class="perf-vs-badge">VS</div>

          <div class="perf-driver-card">
            <div class="perf-driver-accent" style="background: #e8002d;"></div>
            <div class="perf-driver-info">
              <span class="perf-driver-name">Charles Leclerc</span>
              <span class="perf-driver-sub">Scuderia Ferrari • SF-24</span>
            </div>
          </div>
        </div>

        <!-- KPI Stat Grid -->
        <div class="perf-stat-grid" id="perf-kpi-grid">
          ${this.renderStatCards()}
        </div>

        <!-- Telemetry Canvas Visualizer Panel -->
        <div class="perf-visualizer-panel">
          <div class="perf-chart-header">
            <span class="perf-chart-title" id="perf-chart-heading">Speed Trace & Corner Apex Sync</span>
            <div class="perf-segmented-control">
              <button class="perf-segment-btn active" data-range="full">Full Lap</button>
              <button class="perf-segment-btn" data-range="s1">Sector 1</button>
              <button class="perf-segment-btn" data-range="s2">Sector 2</button>
              <button class="perf-segment-btn" data-range="s3">Sector 3</button>
            </div>
          </div>
          <div class="perf-chart-container">
            <canvas id="perfCanvas" class="perf-chart-canvas"></canvas>
          </div>
        </div>

        <!-- Corner-by-Corner Speed Analysis Table -->
        <div class="perf-table-panel">
          <table class="perf-table">
            <thead>
              <tr>
                <th>Turn</th>
                <th>Turn Type</th>
                <th>Car A Min Speed</th>
                <th>Car B Min Speed</th>
                <th>Apex Delta</th>
                <th>Braking Point Delta</th>
              </tr>
            </thead>
            <tbody id="perf-corner-rows">
              ${this.renderCornerRows()}
            </tbody>
          </table>
        </div>
      </section>
    `;

    this.drawTelemetryTrace();
  }

  renderStatCards() {
    return `
      <div class="perf-stat-card">
        <div class="perf-stat-header">
          <span>Top Speed (Speed Trap)</span>
          <span class="perf-badge">DRS ON</span>
        </div>
        <div class="perf-stat-value">
          338.4 <span class="perf-stat-unit">km/h</span>
        </div>
        <div class="perf-stat-delta gain">+3.2 km/h vs SF-24</div>
      </div>

      <div class="perf-stat-card">
        <div class="perf-stat-header">
          <span>Slow Speed Apex (0-120 km/h)</span>
        </div>
        <div class="perf-stat-value">
          82.6 <span class="perf-stat-unit">km/h</span>
        </div>
        <div class="perf-stat-delta loss">-1.4 km/h vs SF-24</div>
      </div>

      <div class="perf-stat-card">
        <div class="perf-stat-header">
          <span>High Speed Apex (&gt;220 km/h)</span>
        </div>
        <div class="perf-stat-value">
          248.1 <span class="perf-stat-unit">km/h</span>
        </div>
        <div class="perf-stat-delta gain">+4.8 km/h vs SF-24</div>
      </div>

      <div class="perf-stat-card">
        <div class="perf-stat-header">
          <span>Full Throttle % of Lap</span>
        </div>
        <div class="perf-stat-value">
          68.4 <span class="perf-stat-unit">%</span>
        </div>
        <div class="perf-stat-delta gain">+1.2%</span></div>
      </div>
    `;
  }

  renderCornerRows() {
    const corners = [
      { turn: 'T1', type: 'Heavy Braking', carA: '112 km/h', carB: '116 km/h', delta: '-4 km/h', brake: '+3m later' },
      { turn: 'T4', type: 'Medium-Speed', carA: '168 km/h', carB: '164 km/h', delta: '+4 km/h', brake: 'Equal' },
      { turn: 'T9', type: 'High-Speed Sweeper', carA: '254 km/h', carB: '246 km/h', delta: '+8 km/h', brake: 'Lift only' },
      { turn: 'T14', type: 'Hairpin', carA: '74 km/h', carB: '76 km/h', delta: '-2 km/h', brake: '-2m earlier' }
    ];

    return corners.map(c => `
      <tr>
        <td><span class="perf-corner-pill">${c.turn}</span></td>
        <td>${c.type}</td>
        <td>${c.carA}</td>
        <td>${c.carB}</td>
        <td><span class="perf-stat-delta ${c.delta.startsWith('+') ? 'gain' : 'loss'}">${c.delta}</span></td>
        <td>${c.brake}</td>
      </tr>
    `).join('');
  }

  drawTelemetryTrace() {
    const canvas = document.getElementById('perfCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = (canvas.width = canvas.parentElement.clientWidth);
    const height = (canvas.height = canvas.parentElement.clientHeight);

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Car A Trace (Red Bull Blue)
    ctx.strokeStyle = '#3671c6';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const y = (height / 2) + Math.sin(x * 0.02) * 60 + Math.cos(x * 0.05) * 30;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Car B Trace (Ferrari Red)
    ctx.strokeStyle = '#e8002d';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const y = (height / 2) + Math.sin(x * 0.02 + 0.2) * 58 + Math.cos(x * 0.05 + 0.1) * 32;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  bindEvents() {
    this.container.querySelectorAll('.perf-segment-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.perf-segment-btn[data-mode]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentMode = e.currentTarget.dataset.mode;
        // Re-render subviews according to selected mode
      });
    });

    window.addEventListener('resize', () => this.drawTelemetryTrace());
  }
}
