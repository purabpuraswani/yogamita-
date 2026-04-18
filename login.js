const SESSION_KEY = 'sedentary_session';
const PROFILES_KEY = 'sedentary_profiles';
const USERS_KEY = 'sedentary_users';

export function initLogin({ onLoginSuccess, onProfileSubmit }) {
	const loginView = document.getElementById('loginView');
	const dashboardView = document.getElementById('dashboardView');
	const profileModal = document.getElementById('profileModal');

	const signInTab = document.getElementById('signInTab');
	const signUpTab = document.getElementById('signUpTab');
	const authSwitchBtn = document.getElementById('authSwitchBtn');
	const authSubmitBtn = document.getElementById('authSubmitBtn');
	const authError = document.getElementById('authError');
	const fullNameLabel = document.getElementById('fullNameLabel');
	const fullNameInput = document.getElementById('fullNameInput');
	const confirmPasswordLabel = document.getElementById('confirmPasswordLabel');
	const confirmPasswordInput = document.getElementById('confirmPasswordInput');

	const loginForm = document.getElementById('loginForm');
	const emailInput = document.getElementById('emailInput');
	const passwordInput = document.getElementById('passwordInput');

	const profileForm = document.getElementById('profileForm');
	const profileAge = document.getElementById('profileAge');
	const profileHeightCm = document.getElementById('profileHeightCm');
	const profileWeightKg = document.getElementById('profileWeightKg');
	const profileFlexibility = document.getElementById('profileFlexibility');
	const profileExperience = document.getElementById('profileExperience');
	const profileActivityLevel = document.getElementById('profileActivityLevel');
	const profileEatingHabits = document.getElementById('profileEatingHabits');
	const profileSleepHours = document.getElementById('profileSleepHours');
	const profileHealthNotes = document.getElementById('profileHealthNotes');
	let activeUser = null;
	let isSignUpMode = false;

	function getUsers() {
		try {
			const parsed = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
			return Array.isArray(parsed) ? parsed : [];
		} catch (_error) {
			return [];
		}
	}

	function saveUsers(users) {
		localStorage.setItem(USERS_KEY, JSON.stringify(users));
	}

	function findUserIndexByEmail(users, email) {
		return users.findIndex((user) => user.email.toLowerCase() === email.toLowerCase());
	}

	function getProfileMap() {
		try {
			const parsed = JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}');
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch (_error) {
			return {};
		}
	}

	function saveProfileMap(profileMap) {
		localStorage.setItem(PROFILES_KEY, JSON.stringify(profileMap));
	}

	function getSavedProfileByEmail(email) {
		const profileMap = getProfileMap();
		return profileMap[email.toLowerCase()] || null;
	}

	function saveProfileForEmail(email, profile) {
		const profileMap = getProfileMap();
		profileMap[email.toLowerCase()] = profile;
		saveProfileMap(profileMap);
	}

	function saveSession(session) {
		localStorage.setItem(SESSION_KEY, JSON.stringify(session));
	}

	function readSession() {
		try {
			const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
			if (!parsed?.user?.email || !parsed?.profile) {
				return null;
			}
			return parsed;
		} catch (_error) {
			return null;
		}
	}

	function setAuthError(message) {
		authError.textContent = message;
		authError.classList.toggle('hidden', !message);
	}

	function setMode(signUpMode) {
		isSignUpMode = signUpMode;
		signInTab.classList.toggle('active', !signUpMode);
		signUpTab.classList.toggle('active', signUpMode);
		signInTab.setAttribute('aria-selected', String(!signUpMode));
		signUpTab.setAttribute('aria-selected', String(signUpMode));

		fullNameLabel.classList.toggle('hidden', !signUpMode);
		confirmPasswordLabel.classList.toggle('hidden', !signUpMode);
		fullNameInput.required = signUpMode;
		confirmPasswordInput.required = signUpMode;

		authSubmitBtn.textContent = signUpMode ? 'Create Account' : 'Login';
		authSwitchBtn.textContent = signUpMode
			? 'Already have an account? Sign in'
			: 'New user? Create an account';
		setAuthError('');
	}

	signInTab.addEventListener('click', () => setMode(false));
	signUpTab.addEventListener('click', () => setMode(true));
	authSwitchBtn.addEventListener('click', () => setMode(!isSignUpMode));

	loginForm.addEventListener('submit', (event) => {
		event.preventDefault();
		setAuthError('');

		const email = emailInput.value.trim();
		const password = passwordInput.value;
		const fullName = fullNameInput.value.trim();
		const confirmPassword = confirmPasswordInput.value;
		if (!email || !password) {
			setAuthError('Email and password are required.');
			return;
		}

		const users = getUsers();
		const existingUserIndex = findUserIndexByEmail(users, email);
		const existingUser = existingUserIndex >= 0 ? users[existingUserIndex] : null;

		if (isSignUpMode) {
			if (!fullName) {
				setAuthError('Please enter your full name.');
				return;
			}
			if (password.length < 6) {
				setAuthError('Password should be at least 6 characters.');
				return;
			}
			if (password !== confirmPassword) {
				setAuthError('Passwords do not match.');
				return;
			}
			if (existingUser) {
				setAuthError('An account with this email already exists.');
				return;
			}

			users.push({ email, password, fullName });
			saveUsers(users);
		} else {
			if (!existingUser || existingUser.password !== password) {
				setAuthError('Invalid email or password.');
				return;
			}
		}

		const finalUser = users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || {
			email,
			fullName,
		};
		activeUser = { email: finalUser.email, fullName: finalUser.fullName || '' };
		const savedProfile = finalUser.profile || getSavedProfileByEmail(finalUser.email) || null;
		if (savedProfile && !finalUser.profile) {
			const usersLatest = getUsers();
			const syncIndex = findUserIndexByEmail(usersLatest, finalUser.email);
			if (syncIndex >= 0) {
				usersLatest[syncIndex] = {
					...usersLatest[syncIndex],
					profile: savedProfile,
				};
				saveUsers(usersLatest);
			}
		}

		loginView.classList.add('hidden');
		onLoginSuccess(activeUser);

		if (savedProfile) {
			dashboardView.classList.remove('hidden');
			profileModal.classList.add('hidden');
			saveSession({ user: activeUser, profile: savedProfile });
			onProfileSubmit(savedProfile);
			return;
		}

		profileModal.classList.remove('hidden');
	});

	profileForm.addEventListener('submit', (event) => {
		event.preventDefault();

		const age = Math.min(60, Math.max(20, Number(profileAge.value) || 30));
		const heightCm = Math.min(220, Math.max(120, Number(profileHeightCm?.value) || 170));
		const weightKg = Math.min(200, Math.max(30, Number(profileWeightKg?.value) || 70));
		const flexibility = profileFlexibility.value;
		const experience = profileExperience.value;
		const activityLevel = profileActivityLevel?.value || 'moderate';
		const eatingHabits = profileEatingHabits?.value || 'balanced';
		const sleepHours = Math.min(12, Math.max(3, Number(profileSleepHours?.value) || 7));
		const healthNotes = String(profileHealthNotes?.value || '').trim();

		const profile = {
			age,
			heightCm,
			weightKg,
			flexibility,
			experience,
			activityLevel,
			eatingHabits,
			sleepHours,
			healthNotes,
		};
		if (activeUser) {
			const users = getUsers();
			const userIndex = findUserIndexByEmail(users, activeUser.email);
			if (userIndex >= 0) {
				users[userIndex] = {
					...users[userIndex],
					profile,
				};
				saveUsers(users);
			}
			saveProfileForEmail(activeUser.email, profile);
			saveSession({ user: activeUser, profile });
		}
		profileModal.classList.add('hidden');
		dashboardView.classList.remove('hidden');
		onProfileSubmit(profile);
	});

	const persistedSession = readSession();
	if (persistedSession) {
		activeUser = persistedSession.user;
		loginView.classList.add('hidden');
		profileModal.classList.add('hidden');
		dashboardView.classList.remove('hidden');
		onLoginSuccess(persistedSession.user);
		onProfileSubmit(persistedSession.profile);
	}

	setMode(false);
}

export function clearSession() {
	localStorage.removeItem(SESSION_KEY);
}
