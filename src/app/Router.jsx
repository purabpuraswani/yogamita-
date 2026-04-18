import { useEffect } from 'react';
import LegacyBootstrap from './LegacyBootstrap.jsx';

/**
 * Router.jsx - Central module router for YogMitra
 *
 * Routes module selection based on window.__yogmitraActiveModule
 * Currently supports: sedentary (default)
 * Future: mental (placeholder)
 *
 * Each module is completely isolated - no shared logic between modules.
 */
export default function Router() {
	const activeModule = typeof window !== 'undefined' ? window.__yogmitraActiveModule : null;

	// Route based on active module
	// Currently only sedentary is fully implemented
	if (activeModule === 'mental') {
		// Mental module placeholder - to be implemented by mental health team
		return (
			<div style={{ padding: '20px', textAlign: 'center' }}>
				<h2>Mental Health Module</h2>
				<p>This module will be implemented by the mental health team.</p>
			</div>
		);
	}

	// Default to sedentary module (existing, fully implemented)
	return <LegacyBootstrap />;
}
