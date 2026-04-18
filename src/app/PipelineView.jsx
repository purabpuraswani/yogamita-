import { useEffect, useState } from 'react';

const PIPELINE_STORAGE_KEY = 'sedentary_pipeline_view_data';

function toNumberOrNull(value, digits = 2) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function formatValue(value, suffix = '') {
	return value === null || value === undefined ? 'N/A' : `${value}${suffix}`;
}

function readPipelineData() {
	try {
		const parsed = JSON.parse(localStorage.getItem(PIPELINE_STORAGE_KEY) || 'null');
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch (_error) {
		return null;
	}
}

const STEP_KEYS = ['step1', 'step2', 'step3'];

function StageImage({ src, alt, placeholder }) {
	if (src) {
		return <img src={src} alt={alt} className="pipeline-stage-image" />;
	}

	return (
		<div className="pipeline-stage-placeholder">
			<span>{placeholder}</span>
		</div>
	);
}

function StepTripletPreview({ images, fallbackText }) {
	return (
		<div className="pipeline-step-triplet">
			{STEP_KEYS.map((stepKey) => {
				const src = images?.[stepKey] || null;
				return (
					<div key={stepKey} className="pipeline-step-triplet-item">
						<h4>{formatStepName(stepKey)}</h4>
						<StageImage
							src={src}
							alt={`${formatStepName(stepKey)} preview`}
							placeholder={fallbackText}
						/>
					</div>
				);
			})}
		</div>
	);
}

function RawFrameTriplet() {
	return (
		<div className="pipeline-raw-triplet">
			{STEP_KEYS.map((stepKey) => (
				<div key={stepKey} className="pipeline-raw-step-chip">
					<strong>{formatStepName(stepKey)}</strong>
					<span>Raw frame preview not persisted</span>
				</div>
			))}
		</div>
	);
}

function formatStepName(stepKey) {
	if (stepKey === 'step1') return 'Step 1';
	if (stepKey === 'step2') return 'Step 2';
	if (stepKey === 'step3') return 'Step 3';
	return stepKey || 'Unknown Step';
}

export default function PipelineView() {
	const [pipelineData, setPipelineData] = useState(null);

	useEffect(() => {
		setPipelineData(readPipelineData());
	}, []);

	const angleOverallError = toNumberOrNull(pipelineData?.angleAnalysis?.overallAverageError);
	const anglePerformance = pipelineData?.angleAnalysis?.overallPerformance || 'Unknown';
	const scoreFinal = toNumberOrNull(pipelineData?.scores?.overallScore);
	const scoreStep1 = toNumberOrNull(pipelineData?.scores?.step1Score);
	const scoreStep2 = toNumberOrNull(pipelineData?.scores?.step2Score);
	const scoreStep3 = toNumberOrNull(pipelineData?.scores?.step3Score);
	const step1Time = toNumberOrNull(pipelineData?.timing?.userStep1Time);
	const step2Time = toNumberOrNull(pipelineData?.timing?.userStep2Time);
	const step3Time = toNumberOrNull(pipelineData?.timing?.userStep3Time);
	const step1Delay = toNumberOrNull(pipelineData?.timing?.delayStep1);
	const step2Delay = toNumberOrNull(pipelineData?.timing?.delayStep2);
	const step3Delay = toNumberOrNull(pipelineData?.timing?.delayStep3);
	const totalCaptured = pipelineData?.sessionStats?.totalCapturedFrames ?? null;
	const validFrames = pipelineData?.sessionStats?.validSequenceFrames ?? null;
	const totalAnalyzed = pipelineData?.sessionStats?.totalAnalyzedFrames ?? null;
	const skippedFrames = pipelineData?.sessionStats?.skippedFrameCount ?? null;
	const activityStart = pipelineData?.activityWindow?.startIndex ?? pipelineData?.activityWindow?.start ?? null;
	const activityEnd = pipelineData?.activityWindow?.endIndex ?? pipelineData?.activityWindow?.end ?? null;
	const activityMethod = pipelineData?.activityWindow?.method || 'N/A';

	return (
		<main className="pipeline-page">
			<header className="pipeline-header">
				<div>
					<h1>Pipeline View</h1>
					<p>
						Explainable session flow for {pipelineData?.asanaName || 'your latest session'}.
					</p>
				</div>
				<div className="pipeline-header-actions">
					<button
						type="button"
						className="secondary-nav-btn"
						onClick={() => {
							window.location.href = '/';
						}}
					>
						Back To App
					</button>
				</div>
			</header>

			<section className="pipeline-overview-grid">
				<article className="pipeline-overview-card">
					<h3>Frame Intake</h3>
					<div>Total Captured Frames: {formatValue(totalCaptured)}</div>
					<div>Valid Sequence Frames: {formatValue(validFrames)}</div>
					<div>Total Analyzed Frames: {formatValue(totalAnalyzed)}</div>
					<div>Skipped Frames: {formatValue(skippedFrames)}</div>
				</article>

				<article className="pipeline-overview-card">
					<h3>Activity Window</h3>
					<div>Start Index: {formatValue(activityStart)}</div>
					<div>End Index: {formatValue(activityEnd)}</div>
					<div>Detection Method: {activityMethod}</div>
					<div>Step 1 Segment Size: {formatValue(pipelineData?.majorSegmentCounts?.step1)}</div>
					<div>Step 2 Segment Size: {formatValue(pipelineData?.majorSegmentCounts?.step2)}</div>
					<div>Step 3 Segment Size: {formatValue(pipelineData?.majorSegmentCounts?.step3)}</div>
				</article>
			</section>

			<section className="pipeline-overview-card">
				<h3>How 3 Frames Are Selected</h3>
				<div>1) All captured frames pass through temporal filtering.</div>
				<div>2) An activity window is detected to remove idle/transition noise.</div>
				<div>3) Major step segments are built for step1, step2, and step3.</div>
				<div>4) Exactly one representative frame is selected for each step.</div>
				<div>5) Selected frames are used for angle, timing, and final scoring visualization.</div>
			</section>

			<section className="pipeline-flow-wrap">
				<article className="pipeline-stage-card">
					<h2>Raw Frames</h2>
					<RawFrameTriplet />
					<p>All captured session frames enter the temporal pipeline first.</p>
				</article>

				<div className="pipeline-arrow" aria-hidden="true">-&gt;</div>

				<article className="pipeline-stage-card">
					<h2>Skeleton + Keypoints</h2>
					<StepTripletPreview
						images={pipelineData?.images || null}
						fallbackText="Skeleton image unavailable"
					/>
					<p>Keypoints are already generated during session processing and used for stability scoring.</p>
				</article>

				<div className="pipeline-arrow" aria-hidden="true">-&gt;</div>

				<article className="pipeline-stage-card">
					<h2>Stable Frame Selection</h2>
					<div className="pipeline-selection-summary">
						{STEP_KEYS.map((stepKey) => {
							const frame = pipelineData?.selectedFrames?.[stepKey] || null;
							const tier = pipelineData?.frameSelectionTiers?.[stepKey]?.tier || 'N/A';
							const segmentSize = pipelineData?.majorSegmentCounts?.[stepKey] ?? null;
							return (
								<div key={stepKey} className="pipeline-selection-row">
									<strong>{formatStepName(stepKey)}</strong>
									<span>Segment: {formatValue(segmentSize)} frames</span>
									<span>Tier: {tier}</span>
									<span>Chosen frame confidence: {formatValue(toNumberOrNull(frame?.confidence), '%')}</span>
								</div>
							);
						})}
					</div>
					<p>
						Temporal pipeline selects one representative frame per step from stable activity windows.
					</p>
				</article>

				<div className="pipeline-arrow" aria-hidden="true">-&gt;</div>

				<article className="pipeline-stage-card">
					<h2>Angle Analysis</h2>
					<div className="pipeline-metric-list">
						<div>Overall Error: {formatValue(angleOverallError, ' deg')}</div>
						<div>Performance: {anglePerformance}</div>
						<div>Step 1 Error: {formatValue(toNumberOrNull(pipelineData?.angleAnalysis?.steps?.step1?.averageError), ' deg')}</div>
						<div>Step 2 Error: {formatValue(toNumberOrNull(pipelineData?.angleAnalysis?.steps?.step2?.averageError), ' deg')}</div>
						<div>Step 3 Error: {formatValue(toNumberOrNull(pipelineData?.angleAnalysis?.steps?.step3?.averageError), ' deg')}</div>
					</div>
					<p>Uses stored angle outputs from the completed session analysis.</p>
				</article>

				<div className="pipeline-arrow" aria-hidden="true">-&gt;</div>

				<article className="pipeline-stage-card">
					<h2>Score</h2>
					<div className="pipeline-metric-list">
						<div>Final Score: {formatValue(scoreFinal, '/100')}</div>
						<div>Step 1: {formatValue(scoreStep1)}</div>
						<div>Step 2: {formatValue(scoreStep2)}</div>
						<div>Step 3: {formatValue(scoreStep3)}</div>
						<div>Timing Step 1: {formatValue(step1Time, 's')}</div>
						<div>Timing Step 2: {formatValue(step2Time, 's')}</div>
						<div>Timing Step 3: {formatValue(step3Time, 's')}</div>
						<div>Delay Step 1: {formatValue(step1Delay, 's')}</div>
						<div>Delay Step 2: {formatValue(step2Delay, 's')}</div>
						<div>Delay Step 3: {formatValue(step3Delay, 's')}</div>
					</div>
					<p>Final scoring summary from the existing completed session pipeline.</p>
				</article>
			</section>

			<section className="pipeline-selection-grid">
				{STEP_KEYS.map((stepKey) => {
					const frame = pipelineData?.selectedFrames?.[stepKey] || null;
					const tier = pipelineData?.frameSelectionTiers?.[stepKey]?.tier || 'N/A';
					return (
						<article key={stepKey} className="pipeline-step-selection-card">
							<h3>{formatStepName(stepKey)} Selected Frame</h3>
							<StageImage
								src={pipelineData?.images?.[stepKey] || null}
								alt={`${formatStepName(stepKey)} selected frame`}
								placeholder={`${formatStepName(stepKey)} preview unavailable`}
							/>
							<div className="pipeline-metric-list">
								<div>Selection Tier: {tier}</div>
								<div>Label: {frame?.label || 'N/A'}</div>
								<div>Confidence: {formatValue(toNumberOrNull(frame?.confidence), '%')}</div>
								<div>Keypoint Confidence: {formatValue(toNumberOrNull(frame?.keypointConfidence), '%')}</div>
								<div>Movement: {formatValue(toNumberOrNull(frame?.movement))}</div>
								<div>Stability: {formatValue(toNumberOrNull(frame?.stabilityScore))}</div>
								<div>Timestamp: {formatValue(frame?.timestamp)}</div>
							</div>
							<p>
								This is the single representative frame selected for {formatStepName(stepKey)}.
							</p>
						</article>
					);
				})}
			</section>

			{!pipelineData && (
				<section className="pipeline-empty-state">
					<h3>No Session Pipeline Data Yet</h3>
					<p>
						Complete a session and generate a report first, then open View Pipeline.
					</p>
				</section>
			)}
		</main>
	);
}
