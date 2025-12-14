// Password Protection
const REQUIRED_PASSWORD = 'CHATIVE.IO.2025';
const SESSION_KEY = 'conversation_viewer_auth';

// Check authentication on page load
(function checkAuth() {
    const isAuthenticated = sessionStorage.getItem(SESSION_KEY);

    if (!isAuthenticated) {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            const password = prompt('Please enter the password to access this application:');

            if (password === null) {
                // User clicked cancel
                document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Inter, sans-serif; color: #666;"><h2>Access Denied</h2></div>';
                throw new Error('Authentication cancelled');
            }

            if (password === REQUIRED_PASSWORD) {
                sessionStorage.setItem(SESSION_KEY, 'true');
                break;
            }

            attempts++;
            if (attempts < maxAttempts) {
                alert(`Incorrect password. ${maxAttempts - attempts} attempt(s) remaining.`);
            } else {
                alert('Maximum attempts exceeded. Please refresh the page to try again.');
                document.body.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Inter, sans-serif; color: #666; flex-direction: column; gap: 16px;"><h2>Access Denied</h2><p>Maximum password attempts exceeded.</p><button onclick="location.reload()" style="padding: 12px 24px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">Try Again</button></div>';
                throw new Error('Authentication failed');
            }
        }
    }
})();

// Global State
let allConversations = [];
let filteredConversations = [];
let displayedConversations = [];
let currentPage = 0;
const PAGE_SIZE = 50;

// Read state management with localStorage persistence
const READ_CONVERSATIONS_KEY = 'readConversations';
let readConversations = new Set(JSON.parse(localStorage.getItem(READ_CONVERSATIONS_KEY) || '[]'));

// DOM Elements
const jsonFileInput = document.getElementById('jsonFile');
const emptyState = document.getElementById('emptyState');
const conversationsList = document.getElementById('conversationsList');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const loadInfo = document.getElementById('loadInfo');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

// Sidebar Elements
const quickStats = document.getElementById('quickStats');
const filtersSection = document.getElementById('filtersSection');
const exportSection = document.getElementById('exportSection');

// Filter Elements
const searchInput = document.getElementById('searchInput');
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const languageFilter = document.getElementById('languageFilter');
const countryFilter = document.getElementById('countryFilter');
const minMessages = document.getElementById('minMessages');
const maxMessages = document.getElementById('maxMessages');
const minDuration = document.getElementById('minDuration');
const maxDuration = document.getElementById('maxDuration');
const resetFilters = document.getElementById('resetFilters');
const applyFilters = document.getElementById('applyFilters');
const sortBy = document.getElementById('sortBy');

// Export Elements
const exportFiltered = document.getElementById('exportFiltered');
const exportCSV = document.getElementById('exportCSV');
const clearReadStatusBtn = document.getElementById('clearReadStatus');

// Header Elements
const headerTitle = document.getElementById('headerTitle');
const headerSubtitle = document.getElementById('headerSubtitle');

// Event Listeners
jsonFileInput.addEventListener('change', handleFileUpload);
applyFilters.addEventListener('click', applyFiltersFn);
resetFilters.addEventListener('click', resetFiltersFn);
sortBy.addEventListener('change', applySortAndRender);
loadMoreBtn.addEventListener('click', loadMore);
exportFiltered.addEventListener('click', exportFilteredData);
exportCSV.addEventListener('click', exportAsCSV);
clearReadStatusBtn.addEventListener('click', handleClearReadStatus);

// Debounced search
let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFiltersFn, 300);
});

// File Upload Handler
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading('Loading file...');

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            allConversations = Array.isArray(data) ? data : [data];

            // Process conversations
            allConversations = allConversations.map((conv, idx) => ({
                ...conv,
                _index: idx,
                _duration_minutes: calculateDurationMinutes(conv.start_time, conv.end_time),
                _message_count: (conv.messages || []).length
            }));

            filteredConversations = [...allConversations];

            // Show UI sections
            emptyState.style.display = 'none';
            quickStats.style.display = 'block';
            filtersSection.style.display = 'block';
            exportSection.style.display = 'block';

            // Populate filters
            populateFilters();

            // Update stats and render
            updateQuickStats();
            updateHeader();

            // Initial render
            currentPage = 0;
            displayedConversations = [];
            conversationsList.innerHTML = '';
            await renderConversations();

            hideLoading();
        } catch (error) {
            hideLoading();
            alert('Error parsing JSON: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// Populate Filter Options
function populateFilters() {
    // Languages
    const languages = new Set();
    const countries = new Set();

    allConversations.forEach(conv => {
        if (conv.language) languages.add(conv.language);
        if (conv.country && conv.country !== 'unknown') countries.add(conv.country);
    });

    // Populate language filter
    languageFilter.innerHTML = '<option value="all">All Languages</option>';
    Array.from(languages).sort().forEach(lang => {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = lang.toUpperCase();
        languageFilter.appendChild(option);
    });

    // Populate country filter
    countryFilter.innerHTML = '<option value="all">All Countries</option>';
    Array.from(countries).sort().forEach(country => {
        const option = document.createElement('option');
        option.value = country;
        option.textContent = country;
        countryFilter.appendChild(option);
    });

    // Set default date range
    if (allConversations.length > 0) {
        const dates = allConversations.map(c => new Date(c.start_time)).filter(d => !isNaN(d));
        if (dates.length > 0) {
            const minDate = new Date(Math.min(...dates));
            const maxDate = new Date(Math.max(...dates));
            dateFrom.value = formatDateInput(minDate);
            dateTo.value = formatDateInput(maxDate);
        }
    }
}

// Apply Filters
function applyFiltersFn() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const fromDate = dateFrom.value ? new Date(dateFrom.value) : null;
    const toDate = dateTo.value ? new Date(dateTo.value + 'T23:59:59') : null;
    const selectedLanguage = languageFilter.value;
    const selectedCountry = countryFilter.value;
    const minMsg = minMessages.value ? parseInt(minMessages.value) : null;
    const maxMsg = maxMessages.value ? parseInt(maxMessages.value) : null;
    const minDur = minDuration.value ? parseFloat(minDuration.value) : null;
    const maxDur = maxDuration.value ? parseFloat(maxDuration.value) : null;

    filteredConversations = allConversations.filter(conv => {
        // Search filter
        if (searchTerm) {
            const matchesSearch =
                conv.conversation_id.toLowerCase().includes(searchTerm) ||
                conv.customer_id.toLowerCase().includes(searchTerm) ||
                (conv.messages || []).some(msg =>
                    (msg.text || '').toLowerCase().includes(searchTerm)
                );
            if (!matchesSearch) return false;
        }

        // Date range filter
        if (fromDate || toDate) {
            const convDate = new Date(conv.start_time);
            if (fromDate && convDate < fromDate) return false;
            if (toDate && convDate > toDate) return false;
        }

        // Language filter
        if (selectedLanguage !== 'all' && conv.language !== selectedLanguage) {
            return false;
        }

        // Country filter
        if (selectedCountry !== 'all' && conv.country !== selectedCountry) {
            return false;
        }

        // Message count filter
        if (minMsg !== null && conv._message_count < minMsg) return false;
        if (maxMsg !== null && conv._message_count > maxMsg) return false;

        // Duration filter
        if (minDur !== null && conv._duration_minutes < minDur) return false;
        if (maxDur !== null && conv._duration_minutes > maxDur) return false;

        return true;
    });

    // Update and re-render
    updateQuickStats();
    updateHeader();
    currentPage = 0;
    displayedConversations = [];
    conversationsList.innerHTML = '';
    renderConversations();
}

// Reset Filters
function resetFiltersFn() {
    searchInput.value = '';
    languageFilter.value = 'all';
    countryFilter.value = 'all';
    minMessages.value = '';
    maxMessages.value = '';
    minDuration.value = '';
    maxDuration.value = '';

    // Reset date range to full range
    if (allConversations.length > 0) {
        const dates = allConversations.map(c => new Date(c.start_time)).filter(d => !isNaN(d));
        if (dates.length > 0) {
            const minDate = new Date(Math.min(...dates));
            const maxDate = new Date(Math.max(...dates));
            dateFrom.value = formatDateInput(minDate);
            dateTo.value = formatDateInput(maxDate);
        }
    }

    applyFiltersFn();
}

// Sort and Render
function applySortAndRender() {
    const sortValue = sortBy.value;

    filteredConversations.sort((a, b) => {
        switch (sortValue) {
            case 'date-desc':
                return new Date(b.start_time) - new Date(a.start_time);
            case 'date-asc':
                return new Date(a.start_time) - new Date(b.start_time);
            case 'messages-desc':
                return b._message_count - a._message_count;
            case 'messages-asc':
                return a._message_count - b._message_count;
            case 'duration-desc':
                return b._duration_minutes - a._duration_minutes;
            case 'duration-asc':
                return a._duration_minutes - b._duration_minutes;
            default:
                return 0;
        }
    });

    currentPage = 0;
    displayedConversations = [];
    conversationsList.innerHTML = '';
    renderConversations();
}

// Update Quick Stats
function updateQuickStats() {
    const totalMessages = filteredConversations.reduce((sum, conv) => sum + conv._message_count, 0);
    const uniqueCustomers = new Set(filteredConversations.map(c => c.customer_id)).size;
    const avgLength = filteredConversations.length > 0
        ? Math.round(totalMessages / filteredConversations.length)
        : 0;

    document.getElementById('statConversations').textContent = filteredConversations.length.toLocaleString();
    document.getElementById('statMessages').textContent = totalMessages.toLocaleString();
    document.getElementById('statCustomers').textContent = uniqueCustomers.toLocaleString();
    document.getElementById('statAvgLength').textContent = avgLength;
}

// Update Header
function updateHeader() {
    headerTitle.textContent = `Conversations (${filteredConversations.length.toLocaleString()})`;

    if (filteredConversations.length === allConversations.length) {
        headerSubtitle.textContent = 'Showing all conversations';
    } else {
        headerSubtitle.textContent = `Filtered from ${allConversations.length.toLocaleString()} total`;
    }
}

// Render Conversations
async function renderConversations() {
    if (filteredConversations.length === 0) {
        conversationsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <h3>No conversations found</h3>
                <p>Try adjusting your filters</p>
            </div>
        `;
        loadMoreContainer.style.display = 'none';
        return;
    }

    const start = currentPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, filteredConversations.length);
    const toRender = filteredConversations.slice(start, end);

    toRender.forEach(conv => {
        const card = createConversationCard(conv);
        conversationsList.appendChild(card);
    });

    displayedConversations = filteredConversations.slice(0, end);

    // Update load more button
    if (end < filteredConversations.length) {
        loadMoreContainer.style.display = 'block';
        loadMoreBtn.disabled = false;
        loadInfo.textContent = `Showing ${end.toLocaleString()} of ${filteredConversations.length.toLocaleString()}`;
    } else {
        if (filteredConversations.length > PAGE_SIZE) {
            loadMoreContainer.style.display = 'block';
            loadMoreBtn.disabled = true;
            loadInfo.textContent = `All ${filteredConversations.length.toLocaleString()} conversations loaded`;
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }
}

// Create Conversation Card
function createConversationCard(conv) {
    const card = document.createElement('div');
    card.className = 'conversation-card';
    card.dataset.index = conv._index;
    card.dataset.conversationId = conv.conversation_id;

    const messages = conv.messages || [];
    const agentCount = messages.filter(m => m.from === 'agent').length;
    const userCount = messages.filter(m => m.from === 'user').length;
    const isRead = isConversationRead(conv.conversation_id);

    // Add read class if conversation is read
    if (isRead) {
        card.classList.add('read');
    }

    card.innerHTML = `
        <div class="conversation-header">
            <div class="conversation-info">
                <div class="conversation-title">
                    ${isRead ? '' : '<span class="unread-indicator">●</span>'}
                    Conversation #${conv.segment_id || conv._index + 1}
                </div>
                <div class="conversation-meta">
                    <span class="meta-item">📅 ${formatDate(conv.start_time)}</span>
                    <span class="meta-item">⏱️ ${formatDuration(conv._duration_minutes)}</span>
                    <span class="meta-item">💬 ${conv._message_count} msgs</span>
                    ${conv.language ? `<span class="tag">${conv.language.toUpperCase()}</span>` : ''}
                    ${conv.country && conv.country !== 'unknown' ? `<span class="tag">${conv.country}</span>` : ''}
                </div>
            </div>
            <div class="conversation-stats">
                <span class="stat-badge">👤 ${userCount}</span>
                <span class="stat-badge">🎧 ${agentCount}</span>
                <button class="read-toggle-btn" title="${isRead ? 'Mark as unread' : 'Mark as read'}">
                    ${isRead ? '📖' : '📩'}
                </button>
                <span class="toggle-icon">▼</span>
            </div>
        </div>
        <div class="messages-container">
            <div class="messages-list">
                ${renderMessages(messages)}
            </div>
        </div>
    `;

    // Toggle expansion and mark as read when expanded
    card.querySelector('.conversation-header').addEventListener('click', (e) => {
        // Don't toggle if clicking the read/unread button
        if (e.target.closest('.read-toggle-btn')) {
            return;
        }

        const wasExpanded = card.classList.contains('expanded');
        card.classList.toggle('expanded');

        // Mark as read when expanding
        if (!wasExpanded && !isConversationRead(conv.conversation_id)) {
            markConversationAsRead(conv.conversation_id);
            card.classList.add('read');
            // Update the unread indicator and button
            const unreadIndicator = card.querySelector('.unread-indicator');
            if (unreadIndicator) {
                unreadIndicator.remove();
            }
            const readBtn = card.querySelector('.read-toggle-btn');
            readBtn.textContent = '📖';
            readBtn.title = 'Mark as unread';
        }
    });

    // Read/Unread toggle button
    card.querySelector('.read-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const conversationId = conv.conversation_id;
        const currentlyRead = isConversationRead(conversationId);

        if (currentlyRead) {
            markConversationAsUnread(conversationId);
            card.classList.remove('read');
            // Add unread indicator
            const title = card.querySelector('.conversation-title');
            if (!title.querySelector('.unread-indicator')) {
                title.insertAdjacentHTML('afterbegin', '<span class="unread-indicator">●</span>');
            }
            e.target.textContent = '📩';
            e.target.title = 'Mark as read';
        } else {
            markConversationAsRead(conversationId);
            card.classList.add('read');
            // Remove unread indicator
            const unreadIndicator = card.querySelector('.unread-indicator');
            if (unreadIndicator) {
                unreadIndicator.remove();
            }
            e.target.textContent = '📖';
            e.target.title = 'Mark as unread';
        }
    });

    return card;
}

// Render Messages
function renderMessages(messages) {
    if (!messages || messages.length === 0) {
        return '<p style="text-align: center; color: var(--color-text-secondary);">No messages</p>';
    }

    return messages.map(msg => {
        const className = msg.from === 'agent' ? 'agent' : 'user';
        const sender = msg.from === 'agent'
            ? `🎧 Agent${msg.agent_id && msg.agent_id !== 'unknown' ? ' (' + msg.agent_id.substring(0, 8) + ')' : ''}`
            : '👤 User';

        return `
            <div class="message ${className}">
                <div class="message-header">
                    <span class="message-sender">${sender}</span>
                    <span class="message-time">${formatTime(msg.time)}</span>
                </div>
                <div class="message-text">${escapeHtml(msg.text || '')}</div>
            </div>
        `;
    }).join('');
}

// Load More
function loadMore() {
    currentPage++;
    renderConversations();
}

// Export Filtered Data
function exportFilteredData() {
    const dataStr = JSON.stringify(filteredConversations, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `filtered_conversations_${formatDateForFilename()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Export as CSV
function exportAsCSV() {
    const headers = [
        'Conversation ID',
        'Segment ID',
        'Customer ID',
        'Start Time',
        'End Time',
        'Duration (min)',
        'Message Count',
        'User Messages',
        'Agent Messages',
        'Language',
        'Country',
        'IP Address'
    ];

    const rows = filteredConversations.map(conv => {
        const messages = conv.messages || [];
        const userCount = messages.filter(m => m.from === 'user').length;
        const agentCount = messages.filter(m => m.from === 'agent').length;

        return [
            conv.conversation_id,
            conv.segment_id || '',
            conv.customer_id,
            conv.start_time,
            conv.end_time,
            conv._duration_minutes.toFixed(2),
            conv._message_count,
            userCount,
            agentCount,
            conv.language || '',
            conv.country || '',
            conv.ip_address || ''
        ];
    });

    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversations_export_${formatDateForFilename()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Clear Read Status
function handleClearReadStatus() {
    if (confirm('Are you sure you want to clear all read status? This will mark all conversations as unread.')) {
        clearReadState();
        // Re-render all conversations to update their visual state
        currentPage = 0;
        displayedConversations = [];
        conversationsList.innerHTML = '';
        renderConversations();
    }
}

// Utility Functions
function calculateDurationMinutes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const start = new Date(startTime);
    const end = new Date(endTime);
    return (end - start) / 1000 / 60;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatTime(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDuration(minutes) {
    if (minutes < 1) return '< 1m';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
}

function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateForFilename() {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoading(text = 'Loading...') {
    loadingOverlay.style.display = 'flex';
    loadingText.textContent = text;
}

function hideLoading() {
    loadingOverlay.style.display = 'none';
}

// Read state management functions
function markConversationAsRead(conversationId) {
    readConversations.add(conversationId);
    saveReadState();
}

function markConversationAsUnread(conversationId) {
    readConversations.delete(conversationId);
    saveReadState();
}

function isConversationRead(conversationId) {
    return readConversations.has(conversationId);
}

function saveReadState() {
    localStorage.setItem(READ_CONVERSATIONS_KEY, JSON.stringify([...readConversations]));
}

function clearReadState() {
    readConversations.clear();
    saveReadState();
}

