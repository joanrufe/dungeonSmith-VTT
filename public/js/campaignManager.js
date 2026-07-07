// public/js/campaignManager.js
// DM toolbar campaign selector: list, create, and switch campaigns.

export class CampaignManager {
  constructor() {
    this.panel = document.getElementById('campaign-dropdown-menu');
    this.btn = document.getElementById('campaign-dropdown-btn');
    this.overlay = document.getElementById('campaign-restart-overlay');
    this.bindEvents();
    this.loadCampaigns();
  }

  bindEvents() {
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = this.panel.classList.contains('hidden');
      this.panel.classList.toggle('hidden');
      if (wasHidden) this.loadCampaigns();
    });
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.panel.classList.add('hidden'));
  }

  async loadCampaigns() {
    try {
      const res = await fetch('/campaigns');
      if (!res.ok) return;
      const { campaigns, active } = await res.json();
      this.render(campaigns, active);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    }
  }

  render(campaigns, active) {
    this.updateLabel(active);
    this.panel.innerHTML = '';
    if (!campaigns.length) {
      this.panel.innerHTML = '<div class="campaign-dd-empty">No campaigns found</div>';
      return;
    }

    campaigns.forEach((campaign) => {
      const item = document.createElement('div');
      const isActive = campaign.name === active;
      item.className = 'campaign-dd-item' + (isActive ? ' active' : '');
      item.innerHTML = `
        <div class="campaign-dd-info">
          <div class="campaign-dd-name">${this.escapeHtml(campaign.name)}</div>
          ${campaign.description ? `<div class="campaign-dd-desc">${this.escapeHtml(campaign.description)}</div>` : ''}
        </div>
      `;
      if (!isActive) {
        item.addEventListener('click', () => this.switchCampaign(campaign.name));
      }
      this.panel.appendChild(item);
    });

    const footer = document.createElement('div');
    footer.className = 'campaign-dd-footer';
    const createBtn = document.createElement('button');
    createBtn.className = 'campaign-dd-create';
    createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create campaign';
    createBtn.addEventListener('click', () => this.createCampaign());
    footer.appendChild(createBtn);
    this.panel.appendChild(footer);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateLabel(active) {
    const label = document.getElementById('campaign-dropdown-label');
    if (label) label.textContent = active;
  }

  async createCampaign() {
    const name = prompt('Campaign name:');
    if (!name || !name.trim()) return;
    const description = prompt('Description (optional):') || '';
    try {
      const res = await fetch('/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (res.ok) {
        this.loadCampaigns();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to create campaign');
      }
    } catch (err) {
      console.error('Failed to create campaign:', err);
      alert('Failed to create campaign');
    }
  }

  async switchCampaign(name) {
    const confirmed = window.confirm(
      `Switch active campaign to "${name}"?\n\n` +
      'The server must be restarted before the new campaign is loaded.'
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/campaigns/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      this.overlay.querySelector('.campaign-restart-name').textContent = name;
      this.overlay.classList.remove('hidden');
    } catch (err) {
      console.error('Failed to switch campaign:', err);
    }
  }
}
