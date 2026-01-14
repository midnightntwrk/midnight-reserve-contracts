import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";

/**
 * Manages recording and replaying answers for non-interactive test runs
 */
export class AnswersManager {
  private answers: Record<string, any> = {};
  private recordedAnswers: Record<string, any> = {};
  private answersFilePath?: string;
  private shouldRecord: boolean;

  constructor(answersFile?: string, recordAnswers: boolean = false) {
    this.answersFilePath = answersFile;
    this.shouldRecord = recordAnswers;

    if (answersFile && existsSync(answersFile)) {
      try {
        const content = readFileSync(answersFile, "utf-8");
        this.answers = JSON.parse(content);
        console.log(`\n✓ Loaded answers from: ${answersFile}\n`);
      } catch (error) {
        console.warn(`\n⚠ Failed to load answers from ${answersFile}:`, error);
      }
    }
  }

  /**
   * Get a pre-recorded answer for a given prompt
   * @param key Unique key for this prompt (e.g., "tx_confirmation_1")
   * @returns The recorded answer, or undefined if not found
   */
  getAnswer(key: string): any {
    return this.answers[key];
  }

  /**
   * Record an answer for later replay
   * @param key Unique key for this prompt
   * @param answer The answer to record
   */
  recordAnswer(key: string, answer: any): void {
    if (this.shouldRecord) {
      this.recordedAnswers[key] = answer;
    }
  }

  /**
   * Save recorded answers to file
   */
  save(): void {
    if (!this.shouldRecord || !this.answersFilePath) {
      return;
    }

    try {
      // Ensure directory exists
      const dir = dirname(this.answersFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Merge with existing answers if file exists
      let existingAnswers = {};
      if (existsSync(this.answersFilePath)) {
        const content = readFileSync(this.answersFilePath, "utf-8");
        existingAnswers = JSON.parse(content);
      }

      const merged = { ...existingAnswers, ...this.recordedAnswers };

      // Custom replacer to handle BigInt values
      const replacer = (_key: string, value: any) => {
        if (typeof value === "bigint") {
          return value.toString() + "n"; // Add 'n' suffix to indicate it was a BigInt
        }
        return value;
      };

      writeFileSync(
        this.answersFilePath,
        JSON.stringify(merged, replacer, 2),
        "utf-8"
      );

      console.log(`\n✓ Saved answers to: ${this.answersFilePath}\n`);
    } catch (error) {
      console.warn(`\n⚠ Failed to save answers to ${this.answersFilePath}:`, error);
    }
  }

  /**
   * Check if we have a recorded answer for a given key
   */
  hasAnswer(key: string): boolean {
    return key in this.answers;
  }

  /**
   * Get all recorded answers (for debugging)
   */
  getAllAnswers(): Record<string, any> {
    return { ...this.answers };
  }
}
