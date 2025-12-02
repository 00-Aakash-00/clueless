export interface Solution {
	initial_thoughts: string[];
	thought_steps: string[];
	description: string;
	code: string;
}

export interface SolutionsResponse {
	[key: string]: Solution;
}

// Parameter definition for input format
interface InputParameter {
	name: string;
	type: string;
	description?: string;
}

// Test case definition
interface TestCase {
	input: unknown;
	expected_output: unknown;
	description?: string;
}

export interface ProblemStatementData {
	problem_statement: string;
	input_format: {
		description: string;
		parameters: InputParameter[];
	};
	output_format: {
		description: string;
		type: string;
		subtype: string;
	};
	complexity: {
		time: string;
		space: string;
	};
	test_cases: TestCase[];
	validation_type: string;
	difficulty: string;
}
