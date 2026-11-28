import { escapeHtml } from '../../coreEngine.js';

const PRIMARY_NAV = [
  { id: 'home', label: 'Home', icon: 'bi-house-door', activeIcon: 'bi-house-door-fill' },
  { id: 'projects', label: 'Projects', icon: 'bi-folder2', activeIcon: 'bi-folder2-open', countKey: 'all' },
  { id: 'templates', label: 'Templates', icon: 'bi-grid-1x2', activeIcon: 'bi-grid-1x2-fill' },
  { id: 'library', label: 'My Assets', icon: 'bi-collection', activeIcon: 'bi-collection-fill' },
  { id: 'ai-tools', label: 'AI Tools', icon: 'bi-stars', activeIcon: 'bi-stars' },
  { id: 'favorites', label: 'Favorites', icon: 'bi-star', activeIcon: 'bi-star-fill', countKey: 'favorites' },
  { id: 'trash', label: 'Trash', icon: 'bi-trash3', activeIcon: 'bi-trash3-fill', countKey: 'trash' }
];

export function renderSidebar(container, { activeRoute, counts, profile, collapsed }) {
  if (!container) return;
  const safeName = escapeHtml(profile?.name || 'LUKRIS User');
  const safePlan = escapeHtml(profile?.plan || 'Local Studio');
  const initials = escapeHtml(profile?.initials || 'LU');
  const avatarColor = escapeHtml(profile?.avatarColor || '#00d4e5');

  container.innerHTML = `
    <div class="lk-sidebar-inner d-flex flex-column h-100">
      <div class="lk-brand-row d-flex align-items-center justify-content-between gap-2">
        <button type="button" class="lk-brand-btn d-flex align-items-center gap-2 border-0 bg-transparent p-0 text-start" data-nav="home" aria-label="LUKRIS Home">
          <span class="lk-logo-mark" aria-hidden="true">
            <img src="./assets/lukris-logo.png" alt="LUKRIS" width="30" height="30" class="lk-logo-img" />
          </span>
          <span class="lk-brand-text-wrap">
            <span class="lk-brand-name">LUKRIS</span>
            <span class="lk-brand-tag">STUDIO</span>
          </span>
        </button>
        <button type="button" id="btnToggleSidebarCollapse" class="lk-collapse-btn d-none d-lg-inline-flex" title="${collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}" aria-label="Toggle Sidebar">
          <i class="bi ${collapsed ? 'bi-layout-sidebar-inset' : 'bi-layout-sidebar'}"></i>
        </button>
      </div>

      <nav class="lk-nav-list flex-grow-1 overflow-y-auto" aria-label="Primary Navigation">
        ${PRIMARY_NAV.map((item) => {
          const isActive = activeRoute === item.id;
          const icon = isActive ? item.activeIcon : item.icon;
          const count = item.countKey ? (counts?.[item.countKey] || 0) : null;
          return `
            <button type="button"
              class="lk-nav-item ${isActive ? 'active' : ''}"
              data-nav="${item.id}"
              title="${item.label}"
              aria-current="${isActive ? 'page' : 'false'}">
              <i class="bi ${icon} lk-nav-icon"></i>
              <span class="lk-nav-label">${item.label}</span>
              ${count !== null && count > 0 ? `<span class="lk-nav-badge">${count}</span>` : ''}
            </button>
          `;
        }).join('')}
      </nav>

      <div class="lk-sidebar-footer">
        <button type="button" class="lk-nav-item lk-profile-nav" data-action="open-profile" title="User Profile">
          <span class="lk-avatar-xs" style="--lk-avatar-bg:${avatarColor};">${initials}</span>
          <span class="lk-nav-label lk-profile-meta">
            <span class="lk-profile-name">${safeName}</span>
            <span class="lk-profile-plan">${safePlan}</span>
          </span>
        </button>
        <button type="button" class="lk-nav-item ${activeRoute === 'credits' ? 'active' : ''}" data-nav="credits" id="btnSidebarCredits" title="Hak Cipta &amp; Credit">
          <i class="bi bi-c-circle lk-nav-icon"></i>
          <span class="lk-nav-label">Hak Cipta &amp; Credit</span>
        </button>
        <button type="button" class="lk-nav-item" data-action="open-settings" title="Settings">
          <i class="bi bi-gear lk-nav-icon"></i>
          <span class="lk-nav-label">Settings</span>
        </button>
        <button type="button" class="lk-nav-item" data-action="open-help" title="Help & Support">
          <i class="bi bi-question-circle lk-nav-icon"></i>
          <span class="lk-nav-label">Help &amp; Support</span>
        </button>
      </div>
    </div>
  `;
}

export function renderMobileBottomNav(container, { activeRoute }) {
  if (!container) return;
  const mobileItems = [
    { id: 'home', label: 'Home', icon: 'bi-house-door', activeIcon: 'bi-house-door-fill' },
    { id: 'projects', label: 'Projects', icon: 'bi-folder2', activeIcon: 'bi-folder2-open' },
    { id: 'templates', label: 'Templates', icon: 'bi-grid-1x2', activeIcon: 'bi-grid-1x2-fill' },
    { id: 'library', label: 'Assets', icon: 'bi-collection', activeIcon: 'bi-collection-fill' },
    { id: 'ai-tools', label: 'AI Tools', icon: 'bi-stars', activeIcon: 'bi-stars' }
  ];

  container.innerHTML = mobileItems.map((item) => {
    const isActive = activeRoute === item.id;
    return `
      <button type="button" class="lk-mobile-nav-btn ${isActive ? 'active' : ''}" data-nav="${item.id}">
        <i class="bi ${isActive ? item.activeIcon : item.icon}"></i>
        <span>${item.label}</span>
      </button>
    `;
  }).join('');
}
