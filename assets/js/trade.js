/**
 * CryptoTop - Spot Trading Terminal Engine
 * Integrated with TradingView Lightweight Charts, Dynamic Depth Order Book,
 * SQLite Backend Deposit/Withdrawal System & Real-Time Sync
 */

(function () {
    'use strict';

    // Pair Base Specifications
    var pairsData = {
        'BTC_USDT': { name: 'BTC/USDT', base: 'BTC', quote: 'USDT', basePrice: 68450.00, step: 0.5, decimals: 2 },
        'ETH_USDT': { name: 'ETH/USDT', base: 'ETH', quote: 'USDT', basePrice: 3850.20, step: 0.1, decimals: 2 },
        'SOL_USDT': { name: 'SOL/USDT', base: 'SOL', quote: 'USDT', basePrice: 145.50, step: 0.05, decimals: 2 },
        'XRP_USDT': { name: 'XRP/USDT', base: 'XRP', quote: 'USDT', basePrice: 0.6120, step: 0.0001, decimals: 4 },
        'ADA_USDT': { name: 'ADA/USDT', base: 'ADA', quote: 'USDT', basePrice: 0.4850, step: 0.0001, decimals: 4 },
        'DOT_USDT': { name: 'DOT/USDT', base: 'DOT', quote: 'USDT', basePrice: 7.250, step: 0.005, decimals: 3 },
        'MATIC_USDT': { name: 'MATIC/USDT', base: 'MATIC', quote: 'USDT', basePrice: 0.720, step: 0.001, decimals: 3 },
        'DOGE_USDT': { name: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', basePrice: 0.1420, step: 0.0001, decimals: 4 },
        'LINK_USDT': { name: 'LINK/USDT', base: 'LINK', quote: 'USDT', basePrice: 18.35, step: 0.02, decimals: 2 }
    };

    var networkDepositInfo = {
        "USDT-BEP20": { min: "10.00 USDT", fee: "0.00% ($0.00)" },
        "USDT-TRC20": { min: "10.00 USDT", fee: "0.00% ($0.00)" }
    };
    var selectedDepositNetwork = "USDT-TRC20";

    // Parse URL parameter ?pair=XYZ_USDT if provided
    var urlParams = new URLSearchParams(window.location.search);
    var queryPair = urlParams.get('pair');
    var currentPairKey = (queryPair && pairsData[queryPair]) ? queryPair : 'BTC_USDT';

    var currentPair = pairsData[currentPairKey];
    var currentPrice = currentPair.basePrice;
    var currentTimeframe = '15m';

    // DOM Elements
    var chartContainer = document.getElementById('spotChart');
    var currentPriceEl = document.getElementById('currentPrice');
    var obCurrentPriceEl = document.getElementById('obCurrentPrice');
    var asksContainer = document.getElementById('asksContainer');
    var bidsContainer = document.getElementById('bidsContainer');
    var activePairTitle = document.getElementById('activePairTitle');
    var openOrdersBody = document.getElementById('openOrdersBody');
    var noOrdersNotice = document.getElementById('noOrdersNotice');

    var chart = null;
    var candleSeries = null;
    var lastCandle = null;
    var candleTimer = null;
    var activeSide = 'buy';
    var liveWalletBalance = 0.00;
    var liveLockedBalance = 0.00;
    var activeHistorySubTab = 'deposits';

    // =========================================================================
    // 1. Toast Notification Helper
    // =========================================================================
    function showToast(title, message, type) {
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
    }

    // =========================================================================
    // 2. Real Backend Wallet Balance Sync & Auth Session
    // =========================================================================
    function getAuthToken() {
        var token = localStorage.getItem('cryptotop_session_token');
        if (!token) {
            var match = document.cookie.match(/(?:^|;\s*)cryptotop_session_token=([^;]+)/);
            if (match) token = match[1];
        }
        return token || '';
    }

    function getAuthHeaders(extra) {
        var headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
        var token = getAuthToken();
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        return headers;
    }

    function syncAuthNavbar() {
        var token = localStorage.getItem('cryptotop_session_token');
        var rawUser = localStorage.getItem('cryptotop_user');
        var user = null;
        try { if (rawUser) user = JSON.parse(rawUser); } catch (e) {}

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
                    if (typeof window.openUserProfileModal === 'function') {
                        window.openUserProfileModal();
                    }
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
                            headers: getAuthHeaders()
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

    function fetchWalletBalance() {
        fetch('/api/wallet/balance', { headers: getAuthHeaders() })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    liveWalletBalance = data.balance;
                    liveLockedBalance = data.locked || 0.00;
                    updateWalletDisplay();
                }
            })
            .catch(function (err) {
                console.error("Failed to fetch wallet balance:", err);
            });
    }

    function updateWalletDisplay() {
        var el = document.getElementById('userWalletBalance');
        if (el) {
            el.innerText = liveWalletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        var lockedWrap = document.getElementById('userLockedWrap');
        var lockedEl = document.getElementById('userLockedBalance');
        if (lockedEl) {
            lockedEl.innerText = liveLockedBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (lockedWrap) {
            if (liveLockedBalance > 0) {
                lockedWrap.classList.remove('hidden');
            } else {
                lockedWrap.classList.add('hidden');
            }
        }
    }

    // =========================================================================
    // 3. Deposit & Withdrawal Modal Management
    // =========================================================================
    var modalOverlay = document.getElementById('walletModalOverlay');
    var modalClose = document.getElementById('walletModalClose');
    var btnDeposit = document.getElementById('btnOpenDeposit');
    var btnWithdraw = document.getElementById('btnOpenWithdraw');

    var tabDepositBtn = document.getElementById('tabDepositBtn');
    var tabWithdrawBtn = document.getElementById('tabWithdrawBtn');
    var tabHistoryBtn = document.getElementById('tabHistoryBtn');
    var tabKycBtn = document.getElementById('tabKycBtn');

    var depositView = document.getElementById('depositView');
    var withdrawView = document.getElementById('withdrawView');
    var historyView = document.getElementById('historyView');
    var kycView = document.getElementById('kycView');

    var kycTabBadge = document.getElementById('kycTabBadge');
    var headerKycBadge = document.getElementById('headerKycBadge');
    var headerKycDot = document.getElementById('headerKycDot');
    var headerKycText = document.getElementById('headerKycText');
    var depositKycGate = document.getElementById('depositKycGate');
    var depositKycGateTitle = document.getElementById('depositKycGateTitle');
    var depositKycGateDesc = document.getElementById('depositKycGateDesc');
    var depositFormWrap = document.getElementById('depositFormWrap');
    var depositKycVerifiedPill = document.getElementById('depositKycVerifiedPill');
    var btnGoToKyc = document.getElementById('btnGoToKyc');
    var btnGoToDeposit = document.getElementById('btnGoToDeposit');
    var withdrawKycGate = document.getElementById('withdrawKycGate');
    var withdrawFormWrap = document.getElementById('withdrawFormWrap');
    var btnGoToKycFromWithdraw = document.getElementById('btnGoToKycFromWithdraw');

    var currentKycStatus = 'UNVERIFIED';

    var confirmDepositBtn = document.getElementById('confirmDepositBtn');
    var confirmWithdrawBtn = document.getElementById('confirmWithdrawBtn');
    var minDepDisplay = document.getElementById('minDepDisplay');
    var depositHistoryTableBody = document.getElementById('depositHistoryTableBody');
    var withdrawHistoryTableBody = document.getElementById('withdrawHistoryTableBody');
    var subTabDeposits = document.getElementById('subTabDeposits');
    var subTabWithdrawals = document.getElementById('subTabWithdrawals');
    var depositTableWrap = document.getElementById('depositTableWrap');
    var withdrawalTableWrap = document.getElementById('withdrawalTableWrap');

    function switchHistorySubTab(sub) {
        activeHistorySubTab = sub;
        if (!depositTableWrap || !withdrawalTableWrap) return;

        if (sub === 'deposits') {
            if (subTabDeposits) {
                subTabDeposits.className = 'flex-1 py-1 rounded-md text-[11px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30 transition-all';
            }
            if (subTabWithdrawals) {
                subTabWithdrawals.className = 'flex-1 py-1 rounded-md text-[11px] font-medium text-[#848E9C] hover:text-white transition-all border border-transparent';
            }
            depositTableWrap.style.display = 'block';
            withdrawalTableWrap.style.display = 'none';
            fetchDepositHistory();
        } else if (sub === 'withdrawals') {
            if (subTabWithdrawals) {
                subTabWithdrawals.className = 'flex-1 py-1 rounded-md text-[11px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30 transition-all';
            }
            if (subTabDeposits) {
                subTabDeposits.className = 'flex-1 py-1 rounded-md text-[11px] font-medium text-[#848E9C] hover:text-white transition-all border border-transparent';
            }
            withdrawalTableWrap.style.display = 'block';
            depositTableWrap.style.display = 'none';
            fetchWithdrawHistory();
        }
    }

    if (subTabDeposits) subTabDeposits.addEventListener('click', function () { switchHistorySubTab('deposits'); });
    if (subTabWithdrawals) subTabWithdrawals.addEventListener('click', function () { switchHistorySubTab('withdrawals'); });

    function updateTradeButtonState() {
        var btn = document.getElementById('orderSubmitBtn');
        if (!btn) return;
        var token = getAuthToken();

        if (!token) {
            btn.className = 'w-full py-3.5 rounded-xl font-bold text-xs md:text-sm text-black bg-gradient-to-r from-amber-400 to-yellow-500 hover:brightness-110 transition-all flex items-center justify-center gap-1.5 mt-3 cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.25)]';
            btn.innerHTML = '<span>Log In / Sign Up to Trade</span> <span class="text-sm">&rarr;</span>';
            return;
        }

        if (currentKycStatus !== 'VERIFIED') {
            btn.className = 'w-full py-3.5 rounded-xl font-bold text-xs md:text-sm text-black bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 transition-all flex items-center justify-center gap-1.5 mt-3 cursor-pointer shadow-[0_0_20px_rgba(245,158,11,0.25)]';
            btn.innerHTML = '<span>Verify KYC to Unlock Trading</span> <span class="text-sm">⚠️</span>';
            return;
        }

        var pairBase = (currentPair && currentPair.base) ? currentPair.base : 'BTC';
        if (activeSide === 'buy') {
            btn.className = 'btn btn-primary w-full py-3 text-sm font-bold mt-2';
            btn.innerText = 'Buy ' + pairBase;
        } else {
            btn.className = 'btn btn-danger w-full py-3 text-sm font-bold mt-2';
            btn.innerText = 'Sell ' + pairBase;
        }
    }

    function updateKycUI(status, ver) {
        currentKycStatus = status || 'UNVERIFIED';

        // Header Badge
        if (headerKycBadge && headerKycText && headerKycDot) {
            headerKycBadge.classList.remove('hidden');
            if (currentKycStatus === 'VERIFIED') {
                headerKycBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-[#0ECB81]/10 text-[#0ECB81] border border-[#0ECB81]/30 hover:border-[#0ECB81] transition-colors flex items-center gap-1.5 cursor-pointer';
                headerKycDot.className = 'w-1.5 h-1.5 rounded-full bg-[#0ECB81]';
                headerKycText.innerText = 'KYC: Verified ✓';
            } else if (currentKycStatus === 'PENDING_REVIEW') {
                headerKycBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:border-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer';
                headerKycDot.className = 'w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse';
                headerKycText.innerText = 'KYC: In Review ⏳';
            } else if (currentKycStatus === 'REJECTED') {
                headerKycBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:border-rose-400 transition-colors flex items-center gap-1.5 cursor-pointer';
                headerKycDot.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
                headerKycText.innerText = 'KYC: Rejected ✗';
            } else {
                headerKycBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:border-amber-400 transition-colors flex items-center gap-1.5 cursor-pointer';
                headerKycDot.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
                headerKycText.innerText = 'KYC: Unverified';
            }
        }

        // Tab Badge
        if (kycTabBadge) {
            if (currentKycStatus === 'VERIFIED') {
                kycTabBadge.className = 'w-1.5 h-1.5 rounded-full bg-[#0ECB81]';
            } else if (currentKycStatus === 'PENDING_REVIEW') {
                kycTabBadge.className = 'w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse';
            } else if (currentKycStatus === 'REJECTED') {
                kycTabBadge.className = 'w-1.5 h-1.5 rounded-full bg-rose-500';
            } else {
                kycTabBadge.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
            }
        }

        // Deposit View Gating & Badging
        if (depositKycGate && depositFormWrap) {
            if (currentKycStatus === 'VERIFIED') {
                depositKycGate.classList.add('hidden');
                depositFormWrap.classList.remove('hidden', 'opacity-40', 'pointer-events-none');
                if (depositKycVerifiedPill) depositKycVerifiedPill.classList.remove('hidden');
                if (confirmDepositBtn) {
                    confirmDepositBtn.disabled = false;
                    confirmDepositBtn.innerText = 'Submit Payment Proof for Verification';
                }
                if (!currentAssignedAddress) {
                    fetchAssignedDepositAddress(selectedDepositNetwork);
                }
            } else {
                depositKycGate.classList.remove('hidden');
                depositFormWrap.classList.add('hidden');
                depositFormWrap.classList.add('pointer-events-none');
                if (depositKycVerifiedPill) depositKycVerifiedPill.classList.add('hidden');
                if (confirmDepositBtn) {
                    confirmDepositBtn.disabled = true;
                    confirmDepositBtn.innerText = 'KYC Verification Required to Deposit';
                }

                // Clear sensitive deposit details from DOM while unverified
                currentAssignedAddress = '';
                if (assignedDepositAddress) assignedDepositAddress.innerText = '—';
                if (depositQrImg) {
                    depositQrImg.src = '';
                    depositQrImg.classList.add('hidden');
                }
                var qrPlaceholder = document.getElementById('depositQrPlaceholder');
                if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');

                if (currentKycStatus === 'PENDING_REVIEW') {
                    if (depositKycGateTitle) depositKycGateTitle.innerText = 'Identity Verification Under Review ⏳';
                    if (depositKycGateDesc) depositKycGateDesc.innerText = 'Your verification application is currently under compliance review. Deposits and trading will activate once approved.';
                    if (btnGoToKyc) btnGoToKyc.innerText = 'View Verification Status ⏳';
                } else if (currentKycStatus === 'REJECTED') {
                    if (depositKycGateTitle) depositKycGateTitle.innerText = 'Identity Verification Needs Attention ✗';
                    if (depositKycGateDesc) depositKycGateDesc.innerText = 'Your previous verification was rejected: ' + ((ver && ver.rejection_reason) ? ver.rejection_reason : 'Please submit updated documents.') + ' Re-submission required to unlock deposits and trading.';
                    if (btnGoToKyc) btnGoToKyc.innerText = 'Re-Submit Verification (KYC) →';
                } else {
                    var isGuest = !getAuthToken();
                    if (depositKycGateTitle) depositKycGateTitle.innerText = isGuest ? 'Sign In & Verify to Deposit' : 'Identity Verification (KYC) Required 🛡️';
                    if (depositKycGateDesc) depositKycGateDesc.innerText = isGuest ? 'Please sign in to your account and complete Level 1 Identity Verification to receive a secure deposit address.' : 'Under international compliance regulations, Level 1 Identity Verification is required before depositing digital assets into your Spot Wallet.';
                    if (btnGoToKyc) btnGoToKyc.innerText = isGuest ? 'Sign In / Register Now →' : 'Complete Identity Verification (KYC) Now →';
                }
            }
        }

        // Withdraw View Gating
        if (withdrawKycGate && withdrawFormWrap) {
            if (currentKycStatus === 'VERIFIED') {
                withdrawKycGate.classList.add('hidden');
                withdrawFormWrap.classList.remove('opacity-40', 'pointer-events-none');
                if (confirmWithdrawBtn) {
                    confirmWithdrawBtn.disabled = false;
                    confirmWithdrawBtn.innerText = 'Confirm Withdrawal';
                }
            } else {
                withdrawKycGate.classList.remove('hidden');
                withdrawFormWrap.classList.add('opacity-40', 'pointer-events-none');
                if (confirmWithdrawBtn) {
                    confirmWithdrawBtn.disabled = true;
                    confirmWithdrawBtn.innerText = 'KYC Verification Required to Withdraw';
                }
            }
        }

        // Synchronize Spot Trading Terminal CTA button state
        updateTradeButtonState();

        // KYC Tab Views
        var kycStatusTag = document.getElementById('kycStatusTag');
        var kycStatusTitle = document.getElementById('kycStatusTitle');
        var kycStatusDesc = document.getElementById('kycStatusDesc');
        var kycVerifiedCard = document.getElementById('kycVerifiedCard');
        var kycPendingCard = document.getElementById('kycPendingCard');
        var kycForm = document.getElementById('kycForm');
        var kycSubmittedAt = document.getElementById('kycSubmittedAt');

        if (kycVerifiedCard) kycVerifiedCard.classList.add('hidden');
        if (kycPendingCard) kycPendingCard.classList.add('hidden');
        if (kycForm) kycForm.classList.add('hidden');

        if (currentKycStatus === 'VERIFIED') {
            if (kycStatusTag) {
                kycStatusTag.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#0ECB81]/20 text-[#0ECB81] border border-[#0ECB81]/30';
                kycStatusTag.innerText = 'VERIFIED ✓';
            }
            if (kycStatusTitle) kycStatusTitle.innerText = 'Account Status: Verified';
            if (kycStatusDesc) kycStatusDesc.innerText = 'Level 1 Identity Verification is active. Deposit gateway and spot trading are unlocked.';
            if (kycVerifiedCard) kycVerifiedCard.classList.remove('hidden');
        } else if (currentKycStatus === 'PENDING_REVIEW') {
            if (kycStatusTag) {
                kycStatusTag.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30';
                kycStatusTag.innerText = 'PENDING REVIEW ⏳';
            }
            if (kycStatusTitle) kycStatusTitle.innerText = 'Account Status: Under Review';
            if (kycStatusDesc) kycStatusDesc.innerText = 'Documents submitted and pending compliance approval. No further action needed.';
            if (kycPendingCard) kycPendingCard.classList.remove('hidden');
            if (kycSubmittedAt && ver && ver.created_at) kycSubmittedAt.innerText = ver.created_at;
        } else if (currentKycStatus === 'REJECTED') {
            if (kycStatusTag) {
                kycStatusTag.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30';
                kycStatusTag.innerText = 'REJECTED ✗';
            }
            if (kycStatusTitle) kycStatusTitle.innerText = 'Account Status: Rejected';
            if (kycStatusDesc) kycStatusDesc.innerText = 'Reason: ' + ((ver && ver.rejection_reason) ? ver.rejection_reason : 'Please provide clearer photos and valid document details.');
            if (kycForm) kycForm.classList.remove('hidden');
        } else {
            if (kycStatusTag) {
                kycStatusTag.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30';
                kycStatusTag.innerText = 'UNVERIFIED';
            }
            if (kycStatusTitle) kycStatusTitle.innerText = 'Account Status: Unverified';
            if (kycStatusDesc) kycStatusDesc.innerText = 'Complete identity verification below to unlock cryptocurrency deposits and spot settlement.';
            if (kycForm) kycForm.classList.remove('hidden');
        }
    }

    function fetchKycStatus() {
        var token = getAuthToken();
        if (!token) return;
        fetch('/api/kyc/status', {
            headers: getAuthHeaders()
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success) {
                updateKycUI(data.kyc_status, data.verification);
            }
        })
        .catch(function () {});
    }

    // Bind KYC File Previews
    var frontDocBase64 = '';
    var backDocBase64 = '';
    var selfieDocBase64 = '';

    // Automatic client-side image compression to prevent large payloads (max 1280px, ~100KB JPEG)
    function compressImage(file, maxDimension, quality, callback) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                var width = img.width;
                var height = img.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                var canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                var compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                callback(compressedBase64);
            };
            img.onerror = function () {
                callback(e.target.result);
            };
            img.src = e.target.result;
        };
        reader.onerror = function () {
            showToast('Read Error', 'Could not read document file.', 'error');
        };
        reader.readAsDataURL(file);
    }

    function bindFilePreview(inputEl, previewEl, promptEl, storeCallback) {
        if (!inputEl) return;
        inputEl.addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
                showToast('File Too Large', 'Please select an image under 15MB.', 'error');
                inputEl.value = '';
                return;
            }
            compressImage(file, 1280, 0.82, function (base64) {
                storeCallback(base64);
                if (previewEl) {
                    var img = previewEl.querySelector('img');
                    if (img) img.src = base64;
                    previewEl.classList.remove('hidden');
                    previewEl.classList.add('flex');
                }
                if (promptEl) promptEl.classList.add('hidden');
            });
        });
    }

    bindFilePreview(document.getElementById('kycFrontInput'), document.getElementById('kycFrontPreview'), document.getElementById('kycFrontPrompt'), function (b64) { frontDocBase64 = b64; });
    bindFilePreview(document.getElementById('kycBackInput'), document.getElementById('kycBackPreview'), document.getElementById('kycBackPrompt'), function (b64) { backDocBase64 = b64; });
    bindFilePreview(document.getElementById('kycSelfieInput'), document.getElementById('kycSelfiePreview'), document.getElementById('kycSelfiePrompt'), function (b64) { selfieDocBase64 = b64; });

    // Handle KYC Form Submission
    var kycFormEl = document.getElementById('kycForm');
    var btnSubmitKyc = document.getElementById('btnSubmitKyc');
    if (kycFormEl) {
        kycFormEl.addEventListener('submit', function (e) {
            e.preventDefault();
            var fullName = (document.getElementById('kycFullName') ? document.getElementById('kycFullName').value : '').trim();
            var dob = (document.getElementById('kycDob') ? document.getElementById('kycDob').value : '').trim();
            var country = (document.getElementById('kycCountry') ? document.getElementById('kycCountry').value : '').trim();
            var idType = (document.getElementById('kycIdType') ? document.getElementById('kycIdType').value : 'National ID').trim();
            var idNumber = (document.getElementById('kycIdNumber') ? document.getElementById('kycIdNumber').value : '').trim();

            if (!fullName || !dob || !country || !idNumber) {
                showToast('Missing Fields', 'Please complete all required fields.', 'error');
                return;
            }

            if (!frontDocBase64) {
                showToast('Document Required', 'Please attach the front side of your ID document.', 'error');
                return;
            }
            if (!selfieDocBase64) {
                showToast('Selfie Required', 'Please attach your selfie face photo.', 'error');
                return;
            }

            if (btnSubmitKyc) {
                btnSubmitKyc.disabled = true;
                btnSubmitKyc.innerText = 'Submitting Documents...';
            }

            fetch('/api/kyc/submit', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: jsonStringify({
                    full_name: fullName,
                    dob: dob,
                    country: country,
                    id_type: idType,
                    id_number: idNumber,
                    front_doc: frontDocBase64,
                    back_doc: backDocBase64,
                    selfie: selfieDocBase64
                })
            })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (btnSubmitKyc) {
                    btnSubmitKyc.disabled = false;
                    btnSubmitKyc.innerText = 'Submit for Verification';
                }
                if (data.success) {
                    showToast('KYC Submitted', data.message || 'Documents received for compliance review.', 'success');
                    fetchKycStatus();
                } else {
                    showToast('Submission Failed', data.error || 'Could not submit verification.', 'error');
                }
            })
            .catch(function () {
                if (btnSubmitKyc) {
                    btnSubmitKyc.disabled = false;
                    btnSubmitKyc.innerText = 'Submit for Verification';
                }
                showToast('Network Error', 'Failed to communicate with compliance server.', 'error');
            });
        });
    }

    function switchModalTab(tab) {
        if (!depositView || !withdrawView || !historyView) return;

        [tabDepositBtn, tabWithdrawBtn, tabHistoryBtn, tabKycBtn].forEach(function (b) {
            if (b) {
                b.className = 'flex-1 py-1.5 rounded-lg text-xs font-medium text-[#848E9C] hover:text-white transition-all';
            }
        });

        if (depositView) depositView.style.display = 'none';
        if (withdrawView) withdrawView.style.display = 'none';
        if (historyView) historyView.style.display = 'none';
        if (kycView) kycView.style.display = 'none';

        if (tab === 'deposit') {
            if (tabDepositBtn) tabDepositBtn.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-[#0ECB81] text-[#080A0D] transition-all';
            if (depositView) depositView.style.display = 'flex';
            fetchKycStatus();
            if (currentKycStatus === 'VERIFIED') {
                fetchAssignedDepositAddress(selectedDepositNetwork);
            } else {
                updateKycUI(currentKycStatus);
            }
        } else if (tab === 'withdraw') {
            if (tabWithdrawBtn) tabWithdrawBtn.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-[#0ECB81] text-[#080A0D] transition-all';
            if (withdrawView) withdrawView.style.display = 'flex';
            var withAvail = document.getElementById('withdrawAvailableBal');
            if (withAvail) withAvail.innerText = '$' + liveWalletBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (tab === 'history') {
            if (tabHistoryBtn) tabHistoryBtn.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-[#0ECB81] text-[#080A0D] transition-all';
            if (historyView) historyView.style.display = 'flex';
            switchHistorySubTab(activeHistorySubTab || 'deposits');
        } else if (tab === 'kyc') {
            if (tabKycBtn) tabKycBtn.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-[#0ECB81] text-[#080A0D] transition-all';
            if (kycView) kycView.style.display = 'flex';
            fetchKycStatus();
        }
    }

    function openWalletModal(tab) {
        if (!modalOverlay) return;
        modalOverlay.classList.add('cryptotop-modal-overlay--open');
        modalOverlay.classList.add('capitexa-modal-overlay--open');
        switchModalTab(tab || 'deposit');
    }

    function closeWalletModal() {
        if (!modalOverlay) return;
        modalOverlay.classList.remove('cryptotop-modal-overlay--open');
        modalOverlay.classList.remove('capitexa-modal-overlay--open');
    }

    if (btnDeposit) btnDeposit.addEventListener('click', function () {
        if (!getAuthToken()) {
            window.location.href = 'login.html';
            return;
        }
        openWalletModal('deposit');
    });
    if (btnWithdraw) btnWithdraw.addEventListener('click', function () {
        if (!getAuthToken()) {
            window.location.href = 'login.html';
            return;
        }
        openWalletModal('withdraw');
    });
    if (modalClose) modalClose.addEventListener('click', closeWalletModal);
    if (modalOverlay) modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeWalletModal();
    });

    if (tabDepositBtn) tabDepositBtn.addEventListener('click', function () { switchModalTab('deposit'); });
    if (tabWithdrawBtn) tabWithdrawBtn.addEventListener('click', function () { switchModalTab('withdraw'); });
    if (tabHistoryBtn) tabHistoryBtn.addEventListener('click', function () { switchModalTab('history'); });
    if (tabKycBtn) tabKycBtn.addEventListener('click', function () { switchModalTab('kyc'); });
    if (btnGoToKyc) btnGoToKyc.addEventListener('click', function () {
        if (!getAuthToken()) {
            window.location.href = 'login.html';
            return;
        }
        switchModalTab('kyc');
    });
    if (btnGoToKycFromWithdraw) btnGoToKycFromWithdraw.addEventListener('click', function () {
        if (!getAuthToken()) {
            window.location.href = 'login.html';
            return;
        }
        switchModalTab('kyc');
    });
    if (btnGoToDeposit) btnGoToDeposit.addEventListener('click', function () { switchModalTab('deposit'); });
    if (headerKycBadge) headerKycBadge.addEventListener('click', function () { openWalletModal('kyc'); });

    // Deposit Network State & Address Assignment
    var networkDepositInfo = {
        'USDT-BEP20': { min: '10.00 USDT', confirmations: 15, fee: '0.00 USDT' },
        'USDT-TRC20': { min: '10.00 USDT', confirmations: 1, fee: '0.00 USDT' }
    };

    var selectedDepositNetwork = 'USDT-BEP20';
    var currentAssignedDepositId = '';
    var currentAssignedAddress = '';

    var assignedDepositAddress = document.getElementById('assignedDepositAddress');
    var depositQrImg = document.getElementById('depositQrImg');
    var depositNetworkBadge = document.getElementById('depositNetworkBadge');
    var btnCopyDepositAddress = document.getElementById('btnCopyDepositAddress');
    var copyAddressBtnText = document.getElementById('copyAddressBtnText');
    var depositTxidInput = document.getElementById('depositTxidInput');

    var networkNameLabels = {
        'USDT-BEP20': 'BNB Smart Chain (BEP20)',
        'USDT-TRC20': 'TRON (TRC20)'
    };

    function fetchAssignedDepositAddress(network) {
        selectedDepositNetwork = network || 'USDT-BEP20';
        if (depositNetworkBadge) depositNetworkBadge.innerText = networkNameLabels[selectedDepositNetwork] || selectedDepositNetwork;

        // Strictly do NOT fetch or reveal deposit addresses if not KYC verified or unauthenticated
        if (currentKycStatus !== 'VERIFIED' || !getAuthToken()) {
            currentAssignedAddress = '';
            if (assignedDepositAddress) assignedDepositAddress.innerText = '—';
            if (depositQrImg) {
                depositQrImg.src = '';
                depositQrImg.classList.add('hidden');
            }
            var qrPlaceholder = document.getElementById('depositQrPlaceholder');
            if (qrPlaceholder) qrPlaceholder.classList.remove('hidden');
            return;
        }

        var netInfo = networkDepositInfo[selectedDepositNetwork] || networkDepositInfo["USDT-BEP20"];
        if (minDepDisplay && netInfo) minDepDisplay.innerText = netInfo.min;

        fetch('/api/deposit/assign-address?network=' + encodeURIComponent(selectedDepositNetwork), {
            headers: getAuthHeaders()
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (data.success && data.address) {
                currentAssignedDepositId = data.deposit_id || '';
                currentAssignedAddress = data.address;

                if (assignedDepositAddress) assignedDepositAddress.innerText = data.address;

                if (depositQrImg) {
                    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(data.address) + '&bgcolor=FFFFFF&color=0B0E11&margin=2';
                    depositQrImg.src = qrUrl;
                    depositQrImg.classList.remove('hidden');
                    depositQrImg.onerror = function () {
                        depositQrImg.src = 'https://quickchart.io/qr?text=' + encodeURIComponent(data.address) + '&size=180';
                    };
                }
                var qrPlaceholder = document.getElementById('depositQrPlaceholder');
                if (qrPlaceholder) qrPlaceholder.classList.add('hidden');

                var netInfoLive = networkDepositInfo[selectedDepositNetwork] || networkDepositInfo["USDT-BEP20"];
                if (minDepDisplay && netInfoLive) minDepDisplay.innerText = netInfoLive.min;
            } else if (data.kyc_required) {
                updateKycUI(data.kyc_status || 'UNVERIFIED');
            }
        })
        .catch(function () {});
    }

    // Copy Assigned Address to Clipboard
    if (btnCopyDepositAddress) {
        btnCopyDepositAddress.addEventListener('click', function () {
            if (!currentAssignedAddress) {
                showToast('No Address', 'Please wait for address to load.', 'error');
                return;
            }

            var textToCopy = currentAssignedAddress;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy).then(onCopied).catch(fallbackCopy);
            } else {
                fallbackCopy();
            }

            function fallbackCopy() {
                var textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand('copy');
                    onCopied();
                } catch (err) {
                    showToast('Copy Failed', 'Please select and copy manually.', 'error');
                }
                document.body.removeChild(textArea);
            }

            function onCopied() {
                if (copyAddressBtnText) copyAddressBtnText.innerText = 'Copied! ✓';
                showToast('Address Copied', 'Deposit address copied to clipboard.', 'success');
                setTimeout(function () {
                    if (copyAddressBtnText) copyAddressBtnText.innerText = 'Copy Address';
                }, 2000);
            }
        });
    }

    // Network selector buttons
    var netButtons = document.querySelectorAll('.net-select-btn');
    netButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            netButtons.forEach(function (b) {
                b.classList.remove('border-[#0ECB81]', 'bg-[#0ECB81]/10', 'text-white', 'font-bold');
                b.classList.add('border-white/10', 'bg-white/[0.02]', 'text-[#848E9C]', 'font-medium');
            });
            btn.classList.add('border-[#0ECB81]', 'bg-[#0ECB81]/10', 'text-white', 'font-bold');
            btn.classList.remove('border-white/10', 'bg-white/[0.02]', 'text-[#848E9C]', 'font-medium');

            var net = btn.dataset.net;
            fetchAssignedDepositAddress(net);
        });
    });

    // Quick Preset Amount Pills
    var quickDepPills = document.querySelectorAll('.quick-dep-amt');
    quickDepPills.forEach(function (p) {
        p.addEventListener('click', function () {
            var amtInput = document.getElementById('depositAmountInput');
            if (amtInput) amtInput.value = p.dataset.amt;
        });
    });

    // Deposit Review Confirmation Modal Logic
    var depositConfirmDialogModal = document.getElementById('depositConfirmDialogModal');
    var confirmModalNetwork = document.getElementById('confirmModalNetwork');
    var confirmModalAmount = document.getElementById('confirmModalAmount');
    var confirmModalTxid = document.getElementById('confirmModalTxid');
    var btnCancelDepositReview = document.getElementById('btnCancelDepositReview');
    var btnProceedDepositSubmit = document.getElementById('btnProceedDepositSubmit');
    var pendingDepositSubmission = null;

    if (btnCancelDepositReview && depositConfirmDialogModal) {
        btnCancelDepositReview.addEventListener('click', function () {
            depositConfirmDialogModal.classList.add('hidden');
            var amtInput = document.getElementById('depositAmountInput');
            if (amtInput) amtInput.focus();
        });
    }

    // Step 1: Open Review Confirmation Popup
    if (confirmDepositBtn) {
        confirmDepositBtn.addEventListener('click', function () {
            var token = getAuthToken();
            if (!token) {
                showToast('Login Required', 'Please log in to your account to submit payment proof.', 'error');
                setTimeout(function () {
                    window.location.href = 'login.html';
                }, 1500);
                return;
            }

            if (currentKycStatus !== 'VERIFIED') {
                showToast('KYC Verification Required', 'Level 1 Identity Verification is required before submitting deposits.', 'error');
                switchModalTab('kyc');
                return;
            }

            var amtInput = document.getElementById('depositAmountInput');
            var amount = parseFloat(amtInput ? amtInput.value : '0');
            var txid = depositTxidInput ? depositTxidInput.value.trim() : '';

            if (isNaN(amount) || amount <= 0) {
                showToast('Invalid Amount', 'Please enter or select a deposit amount (minimum $10 USDT).', 'error');
                if (amtInput) amtInput.focus();
                return;
            }

            if (amount < 10) {
                showToast('Minimum Amount', 'Minimum deposit is $10.00 USDT.', 'error');
                if (amtInput) amtInput.focus();
                return;
            }

            if (!txid || txid.length < 8) {
                showToast('TxID Required', 'Please enter or paste the on-chain transaction hash from your wallet.', 'error');
                if (depositTxidInput) depositTxidInput.focus();
                return;
            }

            pendingDepositSubmission = {
                amount: amount,
                txid: txid,
                network: selectedDepositNetwork
            };

            if (confirmModalNetwork) confirmModalNetwork.innerText = networkNameLabels[selectedDepositNetwork] || selectedDepositNetwork;
            if (confirmModalAmount) confirmModalAmount.innerText = '$' + amount.toFixed(2) + ' USDT';
            if (confirmModalTxid) confirmModalTxid.innerText = txid;

            if (depositConfirmDialogModal) {
                depositConfirmDialogModal.classList.remove('hidden');
            } else {
                executeDepositSubmission();
            }
        });
    }

    // Step 2: Finalize Submission from Confirmation Dialog
    if (btnProceedDepositSubmit) {
        btnProceedDepositSubmit.addEventListener('click', function () {
            if (depositConfirmDialogModal) depositConfirmDialogModal.classList.add('hidden');
            executeDepositSubmission();
        });
    }

    function executeDepositSubmission() {
        if (!pendingDepositSubmission) return;
        var amount = pendingDepositSubmission.amount;
        var txid = pendingDepositSubmission.txid;
        var network = pendingDepositSubmission.network;

        if (confirmDepositBtn) {
            confirmDepositBtn.disabled = true;
            confirmDepositBtn.innerText = 'Submitting Proof...';
        }

        fetch('/api/deposit/submit', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: jsonStringify({
                deposit_id: currentAssignedDepositId,
                address: currentAssignedAddress,
                amount: amount,
                network: network,
                txid: txid
            })
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            if (confirmDepositBtn) {
                confirmDepositBtn.disabled = false;
                confirmDepositBtn.innerText = 'Submit Payment Proof for Verification';
            }

            if (data.success) {
                if (depositTxidInput) depositTxidInput.value = '';
                var amtInput = document.getElementById('depositAmountInput');
                if (amtInput) amtInput.value = '';
                pendingDepositSubmission = null;
                showToast('Payment Proof Submitted', 'Proof for $' + amount.toFixed(2) + ' USDT received. Our desk will verify your on-chain transfer and credit your balance.', 'success');
                switchModalTab('history');
            } else {
                if (data.kyc_required) {
                    showToast('KYC Required', data.error || 'Please complete identity verification to unlock deposits.', 'error');
                    switchModalTab('kyc');
                } else {
                    showToast('Submission Failed', data.error || 'Unable to process deposit.', 'error');
                }
            }
        })
        .catch(function () {
            if (confirmDepositBtn) {
                confirmDepositBtn.disabled = false;
                confirmDepositBtn.innerText = 'Submit Payment Proof for Verification';
            }
            showToast('Network Error', 'Could not reach backend API.', 'error');
        });
    }

    // Withdrawal Network Configurations
    var selectedWithdrawNetwork = 'USDT-TRC20';
    var withdrawNetworkConfigs = {
        'USDT-TRC20': {
            label: 'Destination TRC20 Wallet Address',
            placeholder: 'Enter your TRON (TRC20) USDT address (starts with T...)',
            hint: 'Please ensure the recipient address supports the <strong class="text-white">TRON (TRC20)</strong> network.',
            badge: 'TRC20',
            fee: '1.00 USDT',
            time: '~2-5 Minutes'
        },
        'USDT-BEP20': {
            label: 'Destination BEP20 (BSC) Wallet Address',
            placeholder: 'Enter your BNB Smart Chain (BEP20) USDT address (starts with 0x...)',
            hint: 'Please ensure the recipient address supports the <strong class="text-white">BNB Smart Chain (BEP20)</strong> network.',
            badge: 'BEP20',
            fee: '0.80 USDT',
            time: '~1-3 Minutes'
        }
    };

    var withdrawNetButtons = document.querySelectorAll('.withdraw-net-btn');
    var withdrawDestLabel = document.getElementById('withdrawDestLabel');
    var withdrawNetBadge = document.getElementById('withdrawNetBadge');
    var withdrawDestinationInput = document.getElementById('withdrawDestinationInput');
    var withdrawAddressHint = document.getElementById('withdrawAddressHint');
    var withdrawFeeDisplay = document.getElementById('withdrawFeeDisplay');
    var withdrawTimeDisplay = document.getElementById('withdrawTimeDisplay');

    function applyWithdrawNetwork(net) {
        selectedWithdrawNetwork = net;
        var cfg = withdrawNetworkConfigs[net] || withdrawNetworkConfigs['USDT-TRC20'];

        withdrawNetButtons.forEach(function (b) {
            if (b.dataset.net === net) {
                b.className = 'withdraw-net-btn py-2 rounded-xl text-xs font-bold border border-[#0ECB81] bg-[#0ECB81]/10 text-white transition-all shadow-sm';
            } else {
                b.className = 'withdraw-net-btn py-2 rounded-xl text-xs font-medium border border-white/10 bg-white/[0.02] text-[#848E9C] hover:text-white transition-all';
            }
        });

        if (withdrawDestLabel) withdrawDestLabel.innerText = cfg.label;
        if (withdrawNetBadge) withdrawNetBadge.innerText = cfg.badge;
        if (withdrawDestinationInput) withdrawDestinationInput.placeholder = cfg.placeholder;
        if (withdrawAddressHint) withdrawAddressHint.innerHTML = cfg.hint;
        if (withdrawFeeDisplay) withdrawFeeDisplay.innerText = cfg.fee;
        if (withdrawTimeDisplay) withdrawTimeDisplay.innerText = cfg.time;
    }

    withdrawNetButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            applyWithdrawNetwork(btn.dataset.net);
        });
    });

    // Quick Amount Pills for Withdraw
    var quickWithPills = document.querySelectorAll('.quick-with-amt');
    quickWithPills.forEach(function (p) {
        p.addEventListener('click', function () {
            var amtInput = document.getElementById('withdrawAmountInput');
            if (!amtInput) return;
            var amt = p.dataset.amt;
            if (amt === 'MAX') {
                amtInput.value = Math.max(0, liveWalletBalance).toFixed(2);
            } else {
                var val = parseFloat(amt) || 100;
                amtInput.value = val;
            }
        });
    });

    // Submit Withdrawal to Backend API
    if (confirmWithdrawBtn) {
        confirmWithdrawBtn.addEventListener('click', function () {
            var token = getAuthToken();
            if (!token) {
                showToast('Login Required', 'Please log in to request a withdrawal.', 'error');
                setTimeout(function () {
                    window.location.href = 'login.html';
                }, 1500);
                return;
            }

            if (currentKycStatus !== 'VERIFIED') {
                showToast('KYC Verification Required', 'Level 1 Identity Verification is required before withdrawing.', 'error');
                switchModalTab('kyc');
                return;
            }

            var amtInput = document.getElementById('withdrawAmountInput');
            var destInput = document.getElementById('withdrawDestinationInput');
            var amount = parseFloat(amtInput ? amtInput.value : '0');
            var dest = destInput ? destInput.value.trim() : '';

            if (isNaN(amount) || amount <= 0) {
                showToast('Invalid Amount', 'Please enter a valid withdrawal amount.', 'error');
                return;
            }
            if (!dest) {
                showToast('Address Required', 'Please enter destination crypto address.', 'error');
                return;
            }

            confirmWithdrawBtn.disabled = true;
            confirmWithdrawBtn.innerText = 'Processing Withdrawal...';

            fetch('/api/withdraw', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: jsonStringify({
                    amount: amount,
                    destination: dest,
                    network: selectedWithdrawNetwork
                })
            })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                confirmWithdrawBtn.disabled = false;
                confirmWithdrawBtn.innerText = 'Confirm Withdrawal';

                if (data.success) {
                    liveWalletBalance = data.new_balance;
                    if (data.locked !== undefined) {
                        liveLockedBalance = data.locked;
                    }
                    updateWalletDisplay();
                    closeWalletModal();
                    showToast('Withdrawal Successful', 'Withdrawal of $' + amount.toFixed(2) + ' USDT processed successfully.', 'success');
                    if (destInput) destInput.value = '';
                    fetchWalletBalance();
                    fetchWithdrawHistory();
                } else {
                    showToast('Withdrawal Failed', data.error || 'Unable to process withdrawal.', 'error');
                }
            })
            .catch(function (err) {
                confirmWithdrawBtn.disabled = false;
                confirmWithdrawBtn.innerText = 'Confirm Withdrawal';
                showToast('Network Error', 'Could not reach backend API.', 'error');
            });
        });
    }

    function jsonStringify(obj) {
        return JSON.stringify(obj);
    }

    // Fetch Deposit History from Backend
    function fetchDepositHistory() {
        if (!depositHistoryTableBody) return;
        depositHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#848E9C]">Loading deposits...</td></tr>';

        fetch('/api/deposit/history', { headers: getAuthHeaders() })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success && data.deposits && data.deposits.length > 0) {
                    var html = '';
                    data.deposits.forEach(function (dep) {
                        var dateStr = dep.created_at ? dep.created_at.split(' ')[0] : 'Today';
                        html += '<tr>' +
                            '<td class="py-2.5 px-3 text-white font-medium">' + dateStr + '</td>' +
                            '<td class="py-2.5 px-3 text-[#848E9C]">' + (dep.network ? dep.network.replace('USDT-', '') : 'TRC20') + '</td>' +
                            '<td class="py-2.5 px-3 font-bold text-[#0ECB81]">+$' + parseFloat(dep.amount).toFixed(2) + '</td>' +
                            '<td class="py-2.5 px-3 text-right"><span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30">COMPLETED</span></td>' +
                            '</tr>';
                    });
                    depositHistoryTableBody.innerHTML = html;
                } else {
                    depositHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#848E9C]">No past deposits found.</td></tr>';
                }
            })
            .catch(function () {
                depositHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#F6465D]">Failed to load history.</td></tr>';
            });
    }

    // Fetch Withdrawal History from Backend
    function fetchWithdrawHistory() {
        if (!withdrawHistoryTableBody) return;
        withdrawHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#848E9C]">Loading withdrawals...</td></tr>';

        fetch('/api/withdraw/history', { headers: getAuthHeaders() })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success && data.withdrawals && data.withdrawals.length > 0) {
                    var html = '';
                    data.withdrawals.forEach(function (w) {
                        var dateStr = w.created_at ? w.created_at.split(' ')[0] : 'Today';
                        var destDisplay = w.destination ? (w.destination.length > 14 ? (w.destination.slice(0, 6) + '...' + w.destination.slice(-4)) : w.destination) : 'External';
                        var statusBadge = '';
                        if (w.status === 'PENDING_REVIEW') {
                            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 whitespace-nowrap">PROCESSING ⏳</span>';
                        } else if (w.status === 'COMPLETED') {
                            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30 whitespace-nowrap">COMPLETED ✓</span>';
                        } else if (w.status === 'REJECTED') {
                            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 whitespace-nowrap">REJECTED ✗</span>';
                        } else {
                            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/10 text-[#848E9C] border border-white/15 whitespace-nowrap">' + (w.status || 'PENDING') + '</span>';
                        }

                        html += '<tr>' +
                            '<td class="py-2.5 px-3 text-white font-medium">' + dateStr + '</td>' +
                            '<td class="py-2.5 px-3 text-[#848E9C] font-mono" title="' + (w.destination || '') + '">' + destDisplay + '</td>' +
                            '<td class="py-2.5 px-3 font-bold text-rose-400">-$' + parseFloat(w.amount).toFixed(2) + '</td>' +
                            '<td class="py-2.5 px-3 text-right">' + statusBadge + '</td>' +
                            '</tr>';
                    });
                    withdrawHistoryTableBody.innerHTML = html;
                } else {
                    withdrawHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#848E9C]">No past withdrawals found.</td></tr>';
                }
            })
            .catch(function () {
                withdrawHistoryTableBody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-[#F6465D]">Failed to load withdrawal history.</td></tr>';
            });
    }

    // =========================================================================
    // 4. Dynamic 24h Stats Updater
    // =========================================================================
    function update24hStats() {
        var statChange = document.getElementById('stat24hChange');
        var statHigh = document.getElementById('stat24hHigh');
        var statLow = document.getElementById('stat24hLow');
        var statVol = document.getElementById('stat24hVol');
        if (statChange) {
            var pct = (Math.random() * 4 - 0.8).toFixed(2);
            statChange.innerText = (pct >= 0 ? '+' : '') + pct + '%';
            statChange.className = (pct >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]') + ' font-bold';
        }
        if (statHigh) statHigh.innerText = '$' + (currentPrice * 1.028).toFixed(currentPair.decimals);
        if (statLow) statLow.innerText = '$' + (currentPrice * 0.974).toFixed(currentPair.decimals);
        if (statVol) statVol.innerText = '$' + (Math.random() * 600 + 400).toFixed(1) + 'M';
    }

    // =========================================================================
    // 5. Generate Historical Candlestick Data
    // =========================================================================
    function generateCandles(basePrice, count, step) {
        var candles = [];
        var now = Math.floor(Date.now() / 1000);
        var intervalSeconds = 900;
        var time = now - (count * intervalSeconds);
        var price = basePrice * 0.95;

        for (var i = 0; i < count; i++) {
            var change = (Math.random() - 0.48) * (price * 0.007);
            var open = price;
            var close = price + change;
            var high = Math.max(open, close) + Math.random() * (price * 0.0035);
            var low = Math.min(open, close) - Math.random() * (price * 0.0035);

            candles.push({
                time: time,
                open: parseFloat(open.toFixed(currentPair.decimals)),
                high: parseFloat(high.toFixed(currentPair.decimals)),
                low: parseFloat(low.toFixed(currentPair.decimals)),
                close: parseFloat(close.toFixed(currentPair.decimals))
            });

            price = close;
            time += intervalSeconds;
        }
        return candles;
    }

    // =========================================================================
    // 6. Initialize TradingView Lightweight Chart
    // =========================================================================
    function initChart() {
        if (!chartContainer || typeof LightweightCharts === 'undefined') return;

        chartContainer.innerHTML = '';
        chart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight || 420,
            layout: {
                background: { color: '#181A20' },
                textColor: '#848E9C',
            },
            grid: {
                vertLines: { color: '#1F2329' },
                horzLines: { color: '#1F2329' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: '#0ECB81', width: 1, style: 2 },
                horzLine: { color: '#0ECB81', width: 1, style: 2 },
            },
            rightPriceScale: {
                borderColor: '#2B3139',
                scaleMargins: { top: 0.15, bottom: 0.15 },
            },
            timeScale: {
                borderColor: '#2B3139',
                timeVisible: true,
                secondsVisible: false,
            },
        });

        candleSeries = chart.addCandlestickSeries({
            upColor: '#0ECB81',
            downColor: '#F6465D',
            borderVisible: false,
            wickUpColor: '#0ECB81',
            wickDownColor: '#F6465D',
        });

        loadPairData(currentPairKey);

        window.addEventListener('resize', function () {
            if (chart && chartContainer) {
                chart.applyOptions({ width: chartContainer.clientWidth });
            }
        });
    }

    function formatPrice(val, decimals) {
        return val.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    function loadPairData(pairKey) {
        currentPairKey = pairKey;
        currentPair = pairsData[pairKey];
        currentPrice = currentPair.basePrice;

        if (activePairTitle) {
            activePairTitle.innerHTML = currentPair.base +
                '<span class="text-[#848E9C] text-lg font-medium">/' + currentPair.quote + '</span>' +
                '<span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#0ECB81]/15 text-[#0ECB81] border border-[#0ECB81]/30">0% Maker Fee</span>';
        }

        updateTradeButtonState();

        updatePriceDisplay(currentPrice);
        update24hStats();

        // Highlight active link in pair bar
        var pairLinks = document.querySelectorAll('.pair-links a');
        pairLinks.forEach(function (btn) {
            if (btn.getAttribute('data-pair') === pairKey) {
                btn.classList.add('bg-[#2B3139]', 'text-white', 'font-semibold');
                btn.classList.remove('text-[#848E9C]');
            } else {
                btn.classList.remove('bg-[#2B3139]', 'text-white', 'font-semibold');
                btn.classList.add('text-[#848E9C]');
            }
        });

        var candles = generateCandles(currentPair.basePrice, 100, currentPair.step);
        lastCandle = candles[candles.length - 1];

        if (candleSeries) {
            candleSeries.setData(candles);
            chart.timeScale().fitContent();
        }

        updateOrderBook(currentPrice);
    }

    function updatePriceDisplay(val) {
        currentPrice = val;
        var formatted = formatPrice(val, currentPair.decimals);
        if (currentPriceEl) currentPriceEl.innerText = formatted;
        if (obCurrentPriceEl) {
            obCurrentPriceEl.innerText = formatted;
            obCurrentPriceEl.style.color = Math.random() > 0.5 ? '#0ECB81' : '#F6465D';
        }
        var formPriceInput = document.getElementById('orderPrice');
        if (formPriceInput) {
            formPriceInput.value = val.toFixed(currentPair.decimals);
        }
    }

    // =========================================================================
    // 7. Live Tick Simulation
    // =========================================================================
    function startLiveTicks() {
        if (candleTimer) clearInterval(candleTimer);
        candleTimer = setInterval(function () {
            if (!lastCandle || !candleSeries) return;

            var delta = (Math.random() - 0.49) * (currentPrice * 0.001);
            var newClose = parseFloat((lastCandle.close + delta).toFixed(currentPair.decimals));

            lastCandle.close = newClose;
            if (newClose > lastCandle.high) lastCandle.high = newClose;
            if (newClose < lastCandle.low) lastCandle.low = newClose;

            candleSeries.update(lastCandle);
            updatePriceDisplay(newClose);
            updateOrderBook(newClose);

            if (Math.random() < 0.08) {
                lastCandle = {
                    time: lastCandle.time + 900,
                    open: newClose,
                    high: newClose,
                    low: newClose,
                    close: newClose
                };
            }
        }, 1200);
    }

    // =========================================================================
    // 8. Dynamic Order Book Depth Rendering
    // =========================================================================
    function updateOrderBook(midPrice) {
        if (!asksContainer || !bidsContainer) return;

        var askRowsHtml = '';
        var bidRowsHtml = '';
        var dec = currentPair.decimals;

        // 6 Asks
        var asks = [];
        for (var i = 6; i >= 1; i--) {
            var p = midPrice + (i * currentPair.step * (1 + Math.random() * 0.5));
            var amount = (Math.random() * 1.5 + 0.05).toFixed(3);
            var depthPct = Math.min(95, Math.floor(Math.random() * 70 + 20));
            asks.push({ price: p, amount: amount, depth: depthPct });
        }

        asks.forEach(function (a) {
            askRowsHtml += '<div class="depth-row flex justify-between font-mono text-xs py-1 relative items-center">' +
                '<span class="text-[#F6465D] relative z-10 font-medium">' + a.price.toFixed(dec) + '</span>' +
                '<span class="text-[#EAECEF] relative z-10 opacity-90">' + a.amount + '</span>' +
                '<div class="depth-bar-red absolute right-0 top-0 bottom-0 bg-[#F6465D] opacity-15" style="width:' + a.depth + '%;"></div>' +
                '</div>';
        });
        asksContainer.innerHTML = askRowsHtml;

        // 6 Bids
        for (var j = 1; j <= 6; j++) {
            var pb = midPrice - (j * currentPair.step * (1 + Math.random() * 0.5));
            var amountB = (Math.random() * 1.8 + 0.08).toFixed(3);
            var depthPctB = Math.min(95, Math.floor(Math.random() * 70 + 20));
            bidRowsHtml += '<div class="depth-row flex justify-between font-mono text-xs py-1 relative items-center">' +
                '<span class="text-[#0ECB81] relative z-10 font-medium">' + pb.toFixed(dec) + '</span>' +
                '<span class="text-[#EAECEF] relative z-10 opacity-90">' + amountB + '</span>' +
                '<div class="depth-bar-green absolute right-0 top-0 bottom-0 bg-[#0ECB81] opacity-15" style="width:' + depthPctB + '%;"></div>' +
                '</div>';
        }
        bidsContainer.innerHTML = bidRowsHtml;
    }

    // =========================================================================
    // 9. Pair Selector Click Listeners
    // =========================================================================
    var pairLinks = document.querySelectorAll('.pair-links a');
    pairLinks.forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            var pairKey = btn.getAttribute('data-pair') || 'BTC_USDT';
            loadPairData(pairKey);
        });
    });

    // Timeframe Switcher
    var tfBtns = document.querySelectorAll('.chart-tf-btn');
    tfBtns.forEach(function (b) {
        b.addEventListener('click', function () {
            tfBtns.forEach(function (el) { el.classList.remove('chart-tf-btn--active', 'bg-[#2B3139]', 'text-white'); });
            b.classList.add('chart-tf-btn--active', 'bg-[#2B3139]', 'text-white');
            currentTimeframe = b.getAttribute('data-tf') || '15m';
            loadPairData(currentPairKey);
        });
    });

    // Buy / Sell Tabs
    var btnBuyTab = document.getElementById('btnBuyTab');
    var btnSellTab = document.getElementById('btnSellTab');
    var orderSubmitBtn = document.getElementById('orderSubmitBtn');

    if (btnBuyTab && btnSellTab) {
        btnBuyTab.addEventListener('click', function () {
            activeSide = 'buy';
            btnBuyTab.className = 'btn btn-primary flex-1 py-2 text-sm font-semibold';
            btnSellTab.className = 'btn btn-hollow flex-1 py-2 text-sm font-semibold';
            updateTradeButtonState();
        });

        btnSellTab.addEventListener('click', function () {
            activeSide = 'sell';
            btnSellTab.className = 'btn btn-danger flex-1 py-2 text-sm font-semibold';
            btnBuyTab.className = 'btn btn-hollow flex-1 py-2 text-sm font-semibold';
            updateTradeButtonState();
        });
    }

    // =========================================================================
    // 10. Order Placement Simulation
    // =========================================================================
    var tradeForm = document.getElementById('tradeForm');
    if (tradeForm) {
        tradeForm.addEventListener('submit', function (e) {
            e.preventDefault();

            var token = getAuthToken();
            if (!token) {
                showToast('Authentication Required', 'Please sign up or log in to place spot orders.', 'error');
                setTimeout(function () {
                    window.location.href = 'login.html';
                }, 1200);
                return;
            }

            if (currentKycStatus !== 'VERIFIED') {
                showToast('KYC Verification Required', 'Level 1 Identity Verification is required to trade cryptocurrency on the spot exchange.', 'error');
                openWalletModal('kyc');
                return;
            }

            var priceInput = document.getElementById('orderPrice');
            var amountInput = document.getElementById('orderAmount');
            var price = parseFloat(priceInput ? priceInput.value : currentPrice);
            var amount = parseFloat(amountInput ? amountInput.value : '0.05');

            if (isNaN(price) || isNaN(amount) || amount <= 0) return;

            var orderTotal = price * amount;
            if (activeSide === 'buy') {
                if (orderTotal > liveWalletBalance) {
                    showToast('Insufficient Margin', 'Order total ($' + orderTotal.toFixed(2) + ' USDT) exceeds available wallet balance.', 'error');
                    return;
                }
                liveWalletBalance -= orderTotal;
            } else {
                liveWalletBalance += orderTotal;
            }
            updateWalletDisplay();

            if (noOrdersNotice) noOrdersNotice.style.display = 'none';

            var now = new Date();
            var timeStr = now.toLocaleTimeString();

            var tr = document.createElement('tr');
            tr.className = 'border-b border-white/5 hover:bg-white/[0.02] text-xs font-mono';
            tr.innerHTML = '<td class="py-3 text-white font-medium">' + currentPair.name + '</td>' +
                '<td class="py-3 font-semibold ' + (activeSide === 'buy' ? 'text-[#0ECB81]' : 'text-[#F6465D]') + '">' + activeSide.toUpperCase() + '</td>' +
                '<td class="py-3 text-white">' + formatPrice(price, currentPair.decimals) + '</td>' +
                '<td class="py-3 text-white">' + amount.toFixed(4) + '</td>' +
                '<td class="py-3 text-[#848E9C]">' + timeStr + '</td>' +
                '<td class="py-3 text-right"><button class="text-xs text-[#F6465D] hover:underline cancel-order-btn">Cancel</button></td>';

            if (openOrdersBody) {
                openOrdersBody.prepend(tr);
            }

            tr.querySelector('.cancel-order-btn').addEventListener('click', function () {
                tr.remove();
                if (activeSide === 'buy') {
                    liveWalletBalance += orderTotal;
                    updateWalletDisplay();
                }
                showToast('Order Cancelled', 'Open ' + activeSide.toUpperCase() + ' order removed. Margin released.', 'error');
                if (openOrdersBody && openOrdersBody.children.length === 0 && noOrdersNotice) {
                    noOrdersNotice.style.display = 'block';
                }
            });

            showToast('Order Executed (Maker 0%)',
                activeSide.toUpperCase() + ' ' + amount + ' ' + currentPair.base + ' @ $' + formatPrice(price, currentPair.decimals) + ' USDT',
                'success');
        });
    }

    // =========================================================================
    // 11. Initialization
    // =========================================================================
    window.addEventListener('DOMContentLoaded', function () {
        updateKycUI('UNVERIFIED');
        initChart();
        startLiveTicks();
        fetchWalletBalance();
        fetchKycStatus();
        updateTradeButtonState();

        if (urlParams.get('modal') === 'deposit') {
            setTimeout(function () { openWalletModal('deposit'); }, 400);
        } else if (urlParams.get('modal') === 'history') {
            setTimeout(function () { openWalletModal('history'); }, 400);
        } else if (urlParams.get('modal') === 'kyc') {
            setTimeout(function () { openWalletModal('kyc'); }, 400);
        }
    });

})();
