/**
 * CryptoTop - Core Client Logic
 * Handles PWA Splash, Language Selector, Support Desk, Quick Swap, Markets Filter & Strategy Simulator
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. Toast Notification System
    // =========================================================================
    window.showCryptoTopToast = window.showCapitexaToast = function (title, message, type) {
        var container = document.getElementById('cryptotopToastContainer') || document.getElementById('capitexaToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cryptotopToastContainer';
            container.className = 'cryptotop-toast-container';
            document.body.appendChild(container);
        }

        var toast = document.createElement('div');
        toast.className = 'cryptotop-toast';

        var iconColor = type === 'error' ? '#F6465D' : '#0ECB81';
        var iconSvg = type === 'error' ?
            '<svg class="w-5 h-5 shrink-0" style="color: ' + iconColor + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' :
            '<svg class="w-5 h-5 shrink-0" style="color: ' + iconColor + '" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

        toast.innerHTML = iconSvg +
            '<div class="flex-1">' +
            '<div class="text-xs font-bold font-heading text-white">' + title + '</div>' +
            '<div class="text-[11px] text-[#848E9C] mt-0.5 leading-snug">' + message + '</div>' +
            '</div>';

        container.appendChild(toast);

        setTimeout(function () {
            toast.classList.add('cryptotop-toast--leaving');
            toast.classList.add('capitexa-toast--leaving');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3200);
    };

    // =========================================================================
    // 2. Splash Screen Handling
    // =========================================================================
    var splash = document.getElementById('appSplash');
    if (splash) {
        function hideSplash() {
            splash.classList.add('app-splash--hidden');
            setTimeout(function () {
                if (splash.parentNode) splash.parentNode.removeChild(splash);
            }, 500);
        }

        var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                           (window.navigator && window.navigator.standalone === true);

        if (!isStandalone) {
            setTimeout(hideSplash, 1100);
        } else {
            if (window.sessionStorage && (sessionStorage.getItem('cryptotop_splash_shown') === '1' || sessionStorage.getItem('capitexa_splash_shown') === '1')) {
                hideSplash();
            } else {
                setTimeout(hideSplash, 1600);
                if (window.sessionStorage) sessionStorage.setItem('cryptotop_splash_shown', '1');
            }
        }
    }

    // =========================================================================
    // 3. User Profile & Transaction History Modal
    // =========================================================================
    var profileDataCache = null;
    var currentTxFilter = 'ALL';

    function ensureUserProfileModal() {
        var existing = document.getElementById('userProfileModalOverlay');
        if (existing) return existing;

        var overlay = document.createElement('div');
        overlay.id = 'userProfileModalOverlay';
        overlay.className = 'fixed inset-0 z-50 hidden flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all';
        overlay.innerHTML = 
            '<div class="bg-[#181A20] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">' +
                '<!-- Header -->' +
                '<div class="p-4 sm:p-5 border-b border-white/10 flex justify-between items-center bg-[#12161E]">' +
                    '<div class="flex items-center gap-3">' +
                        '<div id="upmAvatar" class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-tr from-[#0ECB81] to-[#08AEEA] text-[#080A0D] font-black text-sm sm:text-base flex items-center justify-center shadow-[0_0_15px_rgba(14,203,129,0.3)]">' +
                            'U' +
                        '</div>' +
                        '<div>' +
                            '<div class="flex items-center gap-2">' +
                                '<h3 id="upmFullName" class="text-sm sm:text-base font-bold text-white font-heading">User Account</h3>' +
                                '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30">VERIFIED ✓</span>' +
                            '</div>' +
                            '<div id="upmEmail" class="text-xs text-[#848E9C] font-mono mt-0.5">loading profile...</div>' +
                        '</div>' +
                    '</div>' +
                    '<button type="button" id="upmCloseBtn" class="text-2xl text-[#848E9C] hover:text-white transition-colors cursor-pointer px-2 leading-none" title="Close">&times;</button>' +
                '</div>' +

                '<!-- Scrollable Body -->' +
                '<div class="overflow-y-auto p-4 sm:p-5 space-y-4 text-xs flex-1">' +
                    '<!-- Personal Data Grid -->' +
                    '<div class="bg-[#12161E] border border-white/5 rounded-xl p-4">' +
                        '<div class="text-[11px] font-bold uppercase tracking-wider text-[#848E9C] mb-2.5 flex items-center gap-1.5">' +
                            '<span>👤 Account & Personal Data</span>' +
                        '</div>' +
                        '<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 font-sans">' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">First Name</span>' +
                                '<span id="upmFirstName" class="text-xs font-semibold text-white mt-0.5 block">-</span>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Last Name</span>' +
                                '<span id="upmLastName" class="text-xs font-semibold text-white mt-0.5 block">-</span>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Account ID</span>' +
                                '<span id="upmUserId" class="text-xs font-mono font-semibold text-[#0ECB81] mt-0.5 block">-</span>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Phone Number</span>' +
                                '<span id="upmPhone" class="text-xs font-mono text-white mt-0.5 block">-</span>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Date of Birth</span>' +
                                '<span id="upmBirthDate" class="text-xs font-mono text-white mt-0.5 block">-</span>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-2.5 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Member Since</span>' +
                                '<span id="upmCreatedAt" class="text-xs font-mono text-white mt-0.5 block">-</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                    '<!-- Spot Balances Card -->' +
                    '<div class="bg-[#12161E] border border-white/5 rounded-xl p-4">' +
                        '<div class="flex justify-between items-center mb-2.5">' +
                            '<span class="text-[11px] font-bold uppercase tracking-wider text-[#848E9C]">💰 Spot Wallet Equity</span>' +
                            '<span class="text-[10px] font-mono text-[#0ECB81] bg-[#0ECB81]/10 px-2 py-0.5 rounded font-bold">USDT Asset</span>' +
                        '</div>' +
                        '<div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">' +
                            '<div class="bg-white/[0.02] p-3 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Spot Available</span>' +
                                '<div class="text-lg font-black font-mono text-white mt-1">' +
                                    '$<span id="upmBalance">0.00</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-3 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">In Transit / Pending</span>' +
                                '<div class="text-lg font-black font-mono text-amber-400 mt-1">' +
                                    '$<span id="upmLocked">0.00</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="bg-white/[0.02] p-3 rounded-lg border border-white/5">' +
                                '<span class="text-[10px] text-[#848E9C] block uppercase font-medium">Total Net Worth</span>' +
                                '<div class="text-lg font-black font-mono text-[#0ECB81] mt-1">' +
                                    '$<span id="upmTotal">0.00</span>' +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="flex gap-2 mt-3">' +
                            '<a href="trade.html?modal=deposit" class="flex-1 py-2.5 rounded-lg bg-[#0ECB81] text-[#080A0D] font-bold text-center text-xs hover:bg-[#00F59B] transition-all shadow-[0_0_12px_rgba(14,203,129,0.25)] flex items-center justify-center gap-1.5">' +
                                '<span>+ Deposit Funds</span>' +
                            '</a>' +
                            '<a href="trade.html?modal=withdraw" class="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-center text-xs transition-all flex items-center justify-center gap-1.5">' +
                                '<span>&uarr; Withdraw</span>' +
                            '</a>' +
                        '</div>' +
                    '</div>' +

                    '<!-- Transaction & Activity History -->' +
                    '<div class="bg-[#12161E] border border-white/5 rounded-xl p-4">' +
                        '<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">' +
                            '<span class="text-[11px] font-bold uppercase tracking-wider text-[#848E9C]">📜 Complete Transaction History</span>' +
                            '<!-- Sub-tabs -->' +
                            '<div class="flex gap-1 p-0.5 bg-black/40 rounded-lg border border-white/5 text-[11px]">' +
                                '<button type="button" id="upmTabAll" class="px-2.5 py-1 rounded bg-[#0ECB81] text-[#080A0D] font-bold transition-all cursor-pointer">All Activity</button>' +
                                '<button type="button" id="upmTabDeposits" class="px-2.5 py-1 rounded text-[#848E9C] hover:text-white font-medium transition-all cursor-pointer">Deposits</button>' +
                                '<button type="button" id="upmTabWithdrawals" class="px-2.5 py-1 rounded text-[#848E9C] hover:text-white font-medium transition-all cursor-pointer">Withdrawals</button>' +
                            '</div>' +
                        '</div>' +

                        '<div class="max-h-[220px] overflow-y-auto rounded-lg border border-white/5">' +
                            '<table class="w-full text-left font-mono text-[11px]">' +
                                '<thead>' +
                                    '<tr class="bg-black/40 border-b border-white/10 text-[#848E9C] uppercase text-[10px]">' +
                                        '<th class="py-2.5 px-3">Date</th>' +
                                        '<th class="py-2.5 px-3">Type</th>' +
                                        '<th class="py-2.5 px-3">Net / Dest</th>' +
                                        '<th class="py-2.5 px-3">Amount</th>' +
                                        '<th class="py-2.5 px-3 text-right">Status</th>' +
                                    '</tr>' +
                                '</thead>' +
                                '<tbody id="upmTxTableBody" class="divide-y divide-white/5">' +
                                    '<tr><td colspan="5" class="py-8 text-center text-[#848E9C]">Loading transactions...</td></tr>' +
                                '</tbody>' +
                            '</table>' +
                        '</div>' +
                    '</div>' +

                '</div>' +

                '<!-- Footer -->' +
                '<div class="p-3.5 sm:p-4 border-t border-white/10 bg-[#12161E] flex justify-between items-center">' +
                    '<span class="text-[11px] text-[#848E9C]">CryptoTop Secured Client Session</span>' +
                    '<button type="button" id="upmLogoutBtn" class="px-3.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/30 text-xs font-bold transition-all cursor-pointer">' +
                        'Log Out' +
                    '</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        // Attach modal listeners
        document.getElementById('upmCloseBtn').addEventListener('click', closeUserProfileModal);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) closeUserProfileModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
                closeUserProfileModal();
            }
        });

        // Subtabs
        document.getElementById('upmTabAll').addEventListener('click', function () { switchUpmTab('ALL'); });
        document.getElementById('upmTabDeposits').addEventListener('click', function () { switchUpmTab('DEPOSIT'); });
        document.getElementById('upmTabWithdrawals').addEventListener('click', function () { switchUpmTab('WITHDRAWAL'); });

        // Logout
        document.getElementById('upmLogoutBtn').addEventListener('click', async function () {
            var token = localStorage.getItem('cryptotop_session_token');
            try {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
            } catch (e) {}
            localStorage.removeItem('cryptotop_session_token');
            localStorage.removeItem('cryptotop_user');
            document.cookie = 'cryptotop_session_token=; path=/; max-age=0;';
            window.location.href = 'login.html';
        });

        return overlay;
    }

    function switchUpmTab(filter) {
        currentTxFilter = filter;
        var tabAll = document.getElementById('upmTabAll');
        var tabDep = document.getElementById('upmTabDeposits');
        var tabWth = document.getElementById('upmTabWithdrawals');

        var inactiveCls = 'px-2.5 py-1 rounded text-[#848E9C] hover:text-white font-medium transition-all cursor-pointer';
        var activeCls = 'px-2.5 py-1 rounded bg-[#0ECB81] text-[#080A0D] font-bold transition-all cursor-pointer';

        if (tabAll) tabAll.className = filter === 'ALL' ? activeCls : inactiveCls;
        if (tabDep) tabDep.className = filter === 'DEPOSIT' ? activeCls : inactiveCls;
        if (tabWth) tabWth.className = filter === 'WITHDRAWAL' ? activeCls : inactiveCls;

        renderUpmTransactions();
    }

    function renderUpmTransactions() {
        var tbody = document.getElementById('upmTxTableBody');
        if (!tbody || !profileDataCache) return;

        var items = profileDataCache.activity || [];
        if (currentTxFilter === 'DEPOSIT') {
            items = items.filter(function (it) { return it.type === 'DEPOSIT'; });
        } else if (currentTxFilter === 'WITHDRAWAL') {
            items = items.filter(function (it) { return it.type === 'WITHDRAWAL'; });
        }

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-[#848E9C]">No transactions found in this category.</td></tr>';
            return;
        }

        var html = '';
        items.forEach(function (tx) {
            var dateStr = tx.created_at ? tx.created_at.split(' ')[0] : 'Today';
            var isDep = tx.type === 'DEPOSIT';
            var amtCls = isDep ? 'text-[#0ECB81]' : 'text-rose-400';
            var amtSign = isDep ? '+$' : '-$';
            var typeBadge = isDep ?
                '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30">DEPOSIT</span>' :
                '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">WITHDRAW</span>';

            var statusBadge = '';
            if (tx.status === 'COMPLETED') {
                statusBadge = '<span class="text-[9px] font-bold text-[#0ECB81]">COMPLETED ✓</span>';
            } else if (tx.status === 'PENDING_REVIEW' || tx.status === 'PENDING') {
                statusBadge = '<span class="text-[9px] font-bold text-amber-400">PROCESSING ⏳</span>';
            } else if (tx.status === 'REJECTED') {
                statusBadge = '<span class="text-[9px] font-bold text-rose-400">REJECTED ✗</span>';
            } else {
                statusBadge = '<span class="text-[9px] font-bold text-[#848E9C]">' + tx.status + '</span>';
            }

            var detailDisplay = tx.detail ? (tx.detail.length > 14 ? (tx.detail.slice(0, 6) + '...' + tx.detail.slice(-4)) : tx.detail) : (tx.network || 'USDT');

            html += '<tr class="hover:bg-white/[0.02] transition-colors">' +
                '<td class="py-2.5 px-3 text-white font-medium">' + dateStr + '</td>' +
                '<td class="py-2.5 px-3">' + typeBadge + '</td>' +
                '<td class="py-2.5 px-3 text-[#848E9C]" title="' + (tx.detail || '') + '">' + detailDisplay + '</td>' +
                '<td class="py-2.5 px-3 font-bold ' + amtCls + '">' + amtSign + parseFloat(tx.amount).toFixed(2) + '</td>' +
                '<td class="py-2.5 px-3 text-right">' + statusBadge + '</td>' +
                '</tr>';
        });

        tbody.innerHTML = html;
    }

    function openUserProfileModal() {
        var token = localStorage.getItem('cryptotop_session_token');
        if (!token) {
            window.location.href = 'login.html';
            return;
        }

        var overlay = ensureUserProfileModal();
        overlay.classList.remove('hidden');

        // Fetch full profile & transaction history
        fetch('/api/user/full-profile', {
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            }
        })
        .then(function (res) {
            if (res.status === 401) {
                localStorage.removeItem('cryptotop_session_token');
                localStorage.removeItem('cryptotop_user');
                window.location.href = 'login.html';
                throw new Error('Session expired');
            }
            return res.json();
        })
        .then(function (data) {
            if (data.success) {
                profileDataCache = data;
                var user = data.user || {};
                var wallet = data.wallet || {};

                var fullName = ((user.firstName || '') + ' ' + (user.lastName || '')).trim() || (user.email ? user.email.split('@')[0] : 'User');
                var initials = (user.firstName ? user.firstName[0] : '') + (user.lastName ? user.lastName[0] : '') || (user.email ? user.email[0].toUpperCase() : 'U');

                var avatarEl = document.getElementById('upmAvatar');
                if (avatarEl) avatarEl.innerText = initials.toUpperCase();
                var fnEl = document.getElementById('upmFullName');
                if (fnEl) fnEl.innerText = fullName;
                var emEl = document.getElementById('upmEmail');
                if (emEl) emEl.innerText = user.email || '';
                var fstEl = document.getElementById('upmFirstName');
                if (fstEl) fstEl.innerText = user.firstName || 'Not provided';
                var lstEl = document.getElementById('upmLastName');
                if (lstEl) lstEl.innerText = user.lastName || 'Not provided';
                var uidEl = document.getElementById('upmUserId');
                if (uidEl) uidEl.innerText = user.id || '-';
                var phEl = document.getElementById('upmPhone');
                if (phEl) phEl.innerText = user.phone || 'Not provided';
                var bdEl = document.getElementById('upmBirthDate');
                if (bdEl) bdEl.innerText = user.birthDate || 'Not provided';
                var caEl = document.getElementById('upmCreatedAt');
                if (caEl) caEl.innerText = user.createdAt ? user.createdAt.split(' ')[0] : 'Active';

                var balEl = document.getElementById('upmBalance');
                if (balEl) balEl.innerText = (wallet.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                var lckEl = document.getElementById('upmLocked');
                if (lckEl) lckEl.innerText = (wallet.locked || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                var totEl = document.getElementById('upmTotal');
                if (totEl) totEl.innerText = (wallet.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                renderUpmTransactions();
            }
        })
        .catch(function (err) {
            console.error('Failed to load full profile:', err);
        });
    }

    function closeUserProfileModal() {
        var overlay = document.getElementById('userProfileModalOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    window.openUserProfileModal = openUserProfileModal;
    window.closeUserProfileModal = closeUserProfileModal;

    // =========================================================================
    // 4. Dynamic Authentication State in Navbar
    // =========================================================================
    function syncAuthNavbar() {
        var token = localStorage.getItem('cryptotop_session_token');
        var rawUser = localStorage.getItem('cryptotop_user');
        var user = null;
        try { if (rawUser) user = JSON.parse(rawUser); } catch(e) {}

        if (token && user) {
            var loginLinks = document.querySelectorAll('a[href="login.html"]');
            var registerLinks = document.querySelectorAll('a[href="register.html"]');

            loginLinks.forEach(function (el) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'nav-user-badge text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shadow-sm';
                btn.title = 'Click to view your profile and transaction history';
                btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-[#0ECB81] animate-pulse"></span>' +
                    '<span class="font-bold">' + (user.firstName || (user.email ? user.email.split('@')[0] : 'User')) + '</span>' +
                    '<svg class="w-3.5 h-3.5 text-[#848E9C]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
                btn.addEventListener('click', function () {
                    openUserProfileModal();
                });
                if (el.parentNode) el.parentNode.replaceChild(btn, el);
            });

            registerLinks.forEach(function (el) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.id = 'navLogoutBtn';
                btn.className = 'text-xs font-semibold text-[#F6465D] hover:text-white bg-[#F6465D]/10 hover:bg-[#F6465D] border border-[#F6465D]/30 px-3 py-1.5 rounded-lg transition-all cursor-pointer';
                btn.innerText = 'Log Out';
                btn.addEventListener('click', async function () {
                    try {
                        await fetch('/api/auth/logout', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + token }
                        });
                    } catch (e) {}
                    localStorage.removeItem('cryptotop_session_token');
                    localStorage.removeItem('cryptotop_user');
                    document.cookie = 'cryptotop_session_token=; path=/; max-age=0;';
                    window.location.href = 'login.html';
                });
                if (el.parentNode) el.parentNode.replaceChild(btn, el);
            });
        }
    }
    syncAuthNavbar();
    window.syncAuthNavbar = syncAuthNavbar;

    // =========================================================================
    // 4. Language Switcher
    // =========================================================================
    var langSwitch = document.getElementById('langSwitch');
    if (langSwitch) {
        var savedLang = localStorage.getItem('cryptotop_lang') || localStorage.getItem('capitexa_lang') || 'en';
        langSwitch.value = savedLang;
        langSwitch.addEventListener('change', function () {
            localStorage.setItem('cryptotop_lang', this.value);
            document.cookie = 'lang=' + this.value + ';path=/;max-age=31536000';
            showCryptoTopToast('Language Preference', 'Display language set to ' + this.value.toUpperCase(), 'success');
        });
    }

    // =========================================================================
    // 4. Interactive Quick-Swap / Buy-Crypto Widget
    // =========================================================================
    var swapInputPay = document.getElementById('swapInputPay');
    var swapInputReceive = document.getElementById('swapInputReceive');
    var swapTargetToken = document.getElementById('swapTargetToken');
    var swapRateLabel = document.getElementById('swapRateLabel');
    var swapSwitchBtn = document.getElementById('swapSwitchBtn');
    var executeSwapBtn = document.getElementById('executeSwapBtn');

    var tokenPrices = {
        BTC: 68450.00,
        ETH: 3850.20,
        SOL: 145.50,
        BNB: 590.10,
        XRP: 0.6120
    };

    function updateSwapCalculation() {
        if (!swapInputPay || !swapInputReceive || !swapTargetToken) return;
        var payVal = parseFloat(swapInputPay.value);
        if (isNaN(payVal) || payVal <= 0) {
            swapInputReceive.value = '0.00';
            return;
        }

        var token = swapTargetToken.value;
        var price = tokenPrices[token] || 68450.00;
        var receiveAmount = payVal / price;

        swapInputReceive.value = receiveAmount >= 1 ?
            receiveAmount.toFixed(4) :
            receiveAmount.toFixed(6);

        if (swapRateLabel) {
            swapRateLabel.innerText = '1 ' + token + ' ≈ ' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';
        }
    }

    if (swapInputPay) {
        swapInputPay.addEventListener('input', updateSwapCalculation);
    }
    if (swapTargetToken) {
        swapTargetToken.addEventListener('change', updateSwapCalculation);
    }
    if (swapSwitchBtn) {
        swapSwitchBtn.addEventListener('click', function () {
            // Flip and animate
            updateSwapCalculation();
            showCryptoTopToast('Pair Inverted', 'Direct spot liquidity route re-calculated', 'success');
        });
    }
    if (executeSwapBtn) {
        executeSwapBtn.addEventListener('click', function () {
            var token = swapTargetToken ? swapTargetToken.value : 'BTC';
            var amt = swapInputReceive ? swapInputReceive.value : '0.0146';
            showCryptoTopToast('Instant Swap Executed', 'Received ' + amt + ' ' + token + ' with 0% slippage. Balance credited.', 'success');
        });
    }

    // Sync wallet balance with backend
    function syncMainWalletBalance() {
        var balEl = document.getElementById('swapUserBalanceDisplay');
        if (!balEl) return;
        var headers = {};
        var token = localStorage.getItem('cryptotop_session_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        fetch('/api/wallet/balance', { headers: headers })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    balEl.innerText = data.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';
                }
            })
            .catch(function(e) { /* silent */ });
    }
    syncMainWalletBalance();

    // Initialize calculation
    updateSwapCalculation();

    // =========================================================================
    // 5. Interactive Strategy & Profit Simulator
    // =========================================================================
    var capitalRange = document.getElementById('capitalRange');
    var sliderCapitalDisplay = document.getElementById('sliderCapitalDisplay');
    var simApyValue = document.getElementById('simApyValue');
    var simMonthlyProfit = document.getElementById('simMonthlyProfit');
    var simWinRate = document.getElementById('simWinRate');
    var simRiskProfile = document.getElementById('simRiskProfile');
    var strategyPills = document.querySelectorAll('.strategy-pill-btn');

    var currentApy = 28.4;
    var currentWinRate = '84.6%';
    var currentRisk = 'Moderate';

    function recalculateSimulator() {
        if (!capitalRange || !sliderCapitalDisplay || !simMonthlyProfit) return;
        var capital = parseFloat(capitalRange.value) || 5000;
        sliderCapitalDisplay.innerText = '$' + capital.toLocaleString('en-US');

        var monthlyReturn = (capital * (currentApy / 100)) / 12;
        simMonthlyProfit.innerText = '+$' + monthlyReturn.toFixed(2) + ' USDT';
        if (simApyValue) simApyValue.innerText = currentApy.toFixed(1) + '%';
        if (simWinRate) simWinRate.innerText = currentWinRate;
        if (simRiskProfile) simRiskProfile.innerText = currentRisk;
    }

    if (capitalRange) {
        capitalRange.addEventListener('input', recalculateSimulator);
    }

    if (strategyPills.length > 0) {
        strategyPills.forEach(function (btn) {
            btn.addEventListener('click', function () {
                strategyPills.forEach(function (p) {
                    p.classList.remove('border-[#0ECB81]', 'bg-[#0ECB81]/15');
                    p.classList.add('border-white/10', 'bg-white/[0.02]');
                    var heading = p.querySelector('.font-heading');
                    if (heading) heading.classList.replace('text-[#0ECB81]', 'text-white');
                });

                btn.classList.remove('border-white/10', 'bg-white/[0.02]');
                btn.classList.add('border-[#0ECB81]', 'bg-[#0ECB81]/15');
                var activeHeading = btn.querySelector('.font-heading');
                if (activeHeading) activeHeading.classList.replace('text-white', 'text-[#0ECB81]');

                currentApy = parseFloat(btn.dataset.apy) || 28.4;
                currentWinRate = (btn.dataset.win || '84.6') + '%';
                currentRisk = btn.dataset.risk || 'Moderate';

                recalculateSimulator();
                showCryptoTopToast('Strategy Selected', btn.dataset.strategy.toUpperCase() + ' model loaded into backtest simulator', 'success');
            });
        });
    }

    recalculateSimulator();

    // =========================================================================
    // 6. Markets Table Filter Tabs & Live Price Tick Simulation
    // =========================================================================
    var marketTabs = document.querySelectorAll('.market-tab-btn');
    var marketTableBody = document.getElementById('marketTableBody');

    if (marketTabs.length > 0 && marketTableBody) {
        marketTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                marketTabs.forEach(function (t) {
                    t.classList.remove('bg-[#0ECB81]', 'text-[#080A0D]');
                    t.classList.add('text-[#848E9C]');
                });
                tab.classList.add('bg-[#0ECB81]', 'text-[#080A0D]');
                tab.classList.remove('text-[#848E9C]');

                var filter = tab.dataset.filter;
                var rows = Array.from(marketTableBody.querySelectorAll('tr'));

                if (filter === 'gainers') {
                    rows.sort(function (a, b) {
                        return parseFloat(b.dataset.gain) - parseFloat(a.dataset.gain);
                    });
                } else if (filter === 'volume') {
                    rows.sort(function (a, b) {
                        return parseFloat(b.dataset.vol) - parseFloat(a.dataset.vol);
                    });
                } else {
                    // Reset order
                    rows.sort(function (a, b) {
                        return 0.5 - Math.random();
                    });
                }

                rows.forEach(function (row) {
                    marketTableBody.appendChild(row);
                });
            });
        });
    }

    // Periodic subtle price fluctuation for table & marquee
    setInterval(function () {
        var marqueePrices = document.querySelectorAll('#tickerTrack .ticker-item');
        if (marqueePrices.length > 0) {
            var randItem = marqueePrices[Math.floor(Math.random() * marqueePrices.length)];
            var spanPrice = randItem.querySelectorAll('span')[1];
            if (spanPrice) {
                var num = parseFloat(spanPrice.innerText.replace('$', '').replace(/,/g, ''));
                if (!isNaN(num)) {
                    var diff = (Math.random() - 0.48) * (num * 0.0015);
                    var newP = num + diff;
                    spanPrice.innerText = '$' + (newP > 10 ? newP.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : newP.toFixed(4));
                    spanPrice.style.color = diff >= 0 ? '#0ECB81' : '#F6465D';
                    setTimeout(function () { spanPrice.style.color = '#EAECEF'; }, 600);
                }
            }
        }
    }, 1800);

    // =========================================================================
    // 7. Support Desk Modal & Canned Auto-Responder
    // =========================================================================
    var fab = document.getElementById('csSupportFab');
    var overlay = document.getElementById('csSupportOverlay');
    var closeBtn = document.getElementById('csSupportClose');
    var navSupport = document.getElementById('navSupportBtn');
    var form = document.getElementById('csSupportForm');
    var input = document.getElementById('csSupportInput');
    var box = document.getElementById('csSupportMessages');

    var cannedReplies = [
        "Welcome to CryptoTop Support. How may our institutional desk assist your account or algorithmic orders today?",
        "All spot orders on CryptoTop are processed with sub-15ms execution and zero maker fees.",
        "Your assets are protected in verifiable cold-storage vaults with cryptographic Proof of Reserves.",
        "To activate algorithmic Grid Bots, open the Trade terminal and configure your upper/lower grid bands.",
        "A senior support engineer is reviewing your inquiry and will provide detailed guidance shortly."
    ];
    var replyIndex = 0;

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function appendMessage(sender, text) {
        if (!box) return;
        var hint = box.querySelector('.cs-support-hint');
        if (hint) hint.remove();

        var el = document.createElement('div');
        el.className = 'cs-support-msg cs-support-msg--' + (sender === 'staff' ? 'staff' : 'user');

        var now = new Date();
        var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        var label = sender === 'staff' ? 'CryptoTop Desk • ' + timeStr : 'You • ' + timeStr;

        el.innerHTML = '<div style="font-size: 11px; opacity: 0.7; margin-bottom: 4px; font-weight: 500;">' +
            esc(label) + '</div><div style="word-break: break-word;">' + esc(text).replace(/\n/g, '<br>') + '</div>';

        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
    }

    function openSupport() {
        if (!overlay) return;
        overlay.classList.add('cs-support-overlay--open');
        overlay.setAttribute('aria-hidden', 'false');
        setTimeout(function () { if (input) input.focus(); }, 150);
    }

    function closeSupport() {
        if (!overlay) return;
        overlay.classList.remove('cs-support-overlay--open');
        overlay.setAttribute('aria-hidden', 'true');
    }

    if (fab) fab.addEventListener('click', openSupport);
    if (navSupport) navSupport.addEventListener('click', function (e) {
        e.preventDefault();
        openSupport();
    });
    if (closeBtn) closeBtn.addEventListener('click', closeSupport);
    if (overlay) overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeSupport();
    });

    if (form && input) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var text = input.value.trim();
            if (!text) return;
            appendMessage('user', text);
            input.value = '';

            setTimeout(function () {
                var response = cannedReplies[replyIndex % cannedReplies.length];
                replyIndex++;
                appendMessage('staff', response);
            }, 750 + Math.random() * 600);
        });
    }
})();
