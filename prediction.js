const LABELS = ['correct', 'moderate', 'incorrect'];
const FLEXIBILITY_LEVELS = ['low', 'medium', 'high'];
const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];

function toOneHot(value, ordered) {
	return ordered.map((item) => (item === value ? 1 : 0));
}

export class PredictionEngine {
	constructor(modelPath = 'model/model.json') {
		this.modelPath = modelPath;
		this.model = null;
	}

	async load() {
		if (this.model) {
			return this.model;
		}
		this.model = await window.tf.loadLayersModel(this.modelPath);
		return this.model;
	}

	buildInputVector(keypointFeatures, userProfile) {
		const age = Math.max(20, Math.min(60, Number(userProfile.age) || 30));
		const flexibility = toOneHot(userProfile.flexibility, FLEXIBILITY_LEVELS);
		const experience = toOneHot(userProfile.experience, EXPERIENCE_LEVELS);
		return [...keypointFeatures, age, ...flexibility, ...experience];
	}

	async predict(keypointFeatures, userProfile) {
		if (!this.model) {
			await this.load();
		}

		const inputVector = this.buildInputVector(keypointFeatures, userProfile);
		if (inputVector.length !== 41) {
			throw new Error(`Invalid feature length ${inputVector.length}, expected 41.`);
		}

		const tensor = window.tf.tensor2d([inputVector], [1, 41], 'float32');
		const predTensor = this.model.predict(tensor);
		const probs = await predTensor.data();
		tensor.dispose();
		predTensor.dispose();

		let bestIndex = 0;
		for (let i = 1; i < probs.length; i += 1) {
			if (probs[i] > probs[bestIndex]) {
				bestIndex = i;
			}
		}

		return {
			label: LABELS[bestIndex],
			classIndex: bestIndex,
			confidence: probs[bestIndex],
			probabilities: Array.from(probs),
			inputVector,
		};
	}
}
