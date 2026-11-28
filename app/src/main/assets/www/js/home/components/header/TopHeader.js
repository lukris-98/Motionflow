import { escapeHtml } from '../../coreEngine.js';

export function renderTopHeader(container, { searchQuery, unreadCount, notifications, profile }) {
  if (!container) return;
  const initials = escapeHtml(profile?.initials || 'LU');
  const avatarColor = escapeHtml(profile?.avatarColor || '#00d4e5');
  const safeName = escapeHtml(profile?.name || 'LUKRIS User');
  const safeEmail = escapeHtml(profile?.email || 'Local Workspace');
  const notifList = Array.isArray(notifications) ? notifications : [];

  container.innerHTML = `
    <div class="lk-header-inner d-flex align-items-center justify-content-between gap-3 flex-wrap">
      <div class="d-flex align-items-center gap-2 min-w-0">
        <button type="button" id="btnMobileMenu" class="lk-icon-pill d-md-none" aria-label="Open Navigation Menu" title="Menu">
          <i class="bi bi-list fs-5"></i>
        </button>
        <div class="min-w-0">
          <h1 class="lk-greeting mb-0 text-truncate">Welcome back!</h1>
          <p class="lk-subtitle mb-0 text-truncate">What would you like to create today?</p>
        </div>
      </div>

      <div class="lk-header-actions d-flex align-items-center gap-2 ms-auto">
        <div class="lk-search-wrap">
          <i class="bi bi-search lk-search-icon" aria-hidden="true"></i>
          <input
            id="inpHeaderSearch"
            type="search"
            class="lk-search-input"
            placeholder="Search projects..."
            value="${escapeHtml(searchQuery || '')}"
            aria-label="Search projects"
            autocomplete="off" />
          <button type="button" id="btnClearHeaderSearch" class="lk-search-clear ${searchQuery ? '' : 'd-none'}" aria-label="Clear search"><i class="bi bi-x"></i></button>
          <kbd id="kbdHeaderSearch" class="lk-search-kbd d-none ${searchQuery ? '' : 'd-lg-inline-flex'}">/</kbd>
        </div>

        <div class="dropdown">
          <button type="button" id="btnNotifications" class="lk-icon-pill position-relative" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Notifications" title="Notifications">
            <i class="bi bi-bell"></i>
            ${unreadCount > 0 ? `<span class="lk-notif-dot" aria-label="${unreadCount} unread"></span>` : ''}
          </button>
          <div class="dropdown-menu dropdown-menu-end lk-dropdown-panel p-0" style="min-width: 290px;">
            <div class="d-flex align-items-center justify-content-between px-3 py-2 border-bottom lk-border-hairline">
              <span class="small fw-semibold">Notifications</span>
              ${unreadCount > 0 ? `<button type="button" id="btnMarkAllNotifsRead" class="btn btn-link btn-sm p-0 text-info text-decoration-none" style="font-size:0.75rem;">Mark all read</button>` : ''}
            </div>
            <div class="lk-notif-list">
              ${notifList.length > 0 ? notifList.map((n) => `
                <div class="lk-notif-item ${n.unread ? 'is-unread' : ''}">
                  <div class="lk-notif-ic"><i class="bi ${escapeHtml(n.icon || 'bi-bell')}"></i></div>
                  <div class="min-w-0 flex-grow-1">
                    <div class="small fw-semibold text-truncate">${escapeHtml(n.title)}</div>
                    <div class="lk-muted-xs">${escapeHtml(n.desc)}</div>
                    <div class="lk-muted-2xs mt-1">${escapeHtml(n.time)}</div>
                  </div>
                </div>
              `).join('') : `
                <div class="lk-muted-xs text-center py-4 px-3">No notifications yet.</div>
              `}
            </div>
          </div>
        </div>

        <div class="dropdown">
          <button type="button" id="btnUserAvatar" class="lk-avatar-btn" data-bs-toggle="dropdown" aria-expanded="false" aria-label="User Menu" title="${safeName}">
            <span class="lk-avatar-sm" style="--lk-avatar-bg:${avatarColor};">${initials}</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end lk-dropdown-panel">
            <li class="px-3 py-2 border-bottom lk-border-hairline">
              <div class="small fw-semibold text-truncate">${safeName}</div>
              <div class="lk-muted-xs text-truncate">${safeEmail}</div>
            </li>
            <li><button type="button" class="dropdown-item lk-menu-item" data-action="open-profile"><i class="bi bi-person me-2"></i>User Profile</button></li>
            <li><button type="button" class="dropdown-item lk-menu-item" data-action="open-settings"><i class="bi bi-gear me-2"></i>Settings &amp; Performance</button></li>
            <li><button type="button" class="dropdown-item lk-menu-item" data-action="open-help"><i class="bi bi-question-circle me-2"></i>Help &amp; Support</button></li>
          </ul>
        </div>
      </div>
    </div>
  `;
}
