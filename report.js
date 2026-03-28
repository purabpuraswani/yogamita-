function fallbackReport(data) {
	return [
		`Asana: ${data.asana}`,
		`Prediction: ${data.prediction}`,
		`Score: ${data.score.toFixed(1)} / 100`,
		`Age: ${data.age}`,
		`Flexibility: ${data.flexibility}`,
		`Experience: ${data.experience}`,
		'',
		'Key observations:',
		...data.feedback.map((item) => `- ${item}`),
		'',
		'Recommendation:',
		'Practice Konasana in front of a mirror for 3 sets of 30-45 seconds, focus on posture quality before depth, and maintain smooth breathing throughout.',
	].join('\n');
}

export async function generateYogaReport({ data }) {
	const response = await fetch('/api/report', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ data }),
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `Report API failed with status ${response.status}`);
	}

	const result = await response.json();
	if (result?.report) {
		return {
			text: String(result.report),
			source: result.source || 'openrouter',
			model: result.model || null,
			reason: result.reason || null,
		};
	}

	return {
		text: `${fallbackReport(data)}\n\nServer returned no report content.`,
		source: 'fallback',
		model: null,
		reason: 'empty_report',
	};
}
