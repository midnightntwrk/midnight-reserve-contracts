import { StateSnapshot, StepResult } from '../types/DemoFlow';

/**
 * Display Renderer for before/after state visualization
 * Creates structured console output with boxes and comparisons
 */
export class DisplayRenderer {

  renderStepHeader(stepIndex: number, stepName: string, description?: string): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`STEP ${stepIndex}: ${stepName}`);
    if (description) {
      console.log(`Description: ${description}`);
    }
    console.log('='.repeat(60));
  }

  renderStateComparison(beforeState: StateSnapshot, afterState: StateSnapshot): void {
    if (Object.keys(beforeState.data).length === 0) return;

    console.log('\n--- STATE MONITORING ---');
    
    for (const [queryName, beforeValue] of Object.entries(beforeState.data)) {
      const afterValue = afterState.data[queryName];
      
      this.renderStateQuery(queryName, beforeValue, afterValue);
    }
  }

  private renderStateQuery(name: string, beforeValue: any, afterValue: any): void {
    const hasChanged = JSON.stringify(beforeValue) !== JSON.stringify(afterValue);
    const changeIndicator = hasChanged ? '→ CHANGED' : '- No change';
    
    console.log(`\n┌─ ${name} ${'─'.repeat(Math.max(0, 40 - name.length))}┐`);
    console.log('│ BEFORE:');
    this.renderValue(beforeValue, '│   ');
    console.log('│');
    console.log('│ AFTER:');
    this.renderValue(afterValue, '│   ');
    console.log('│');
    console.log(`│ ${changeIndicator}`);
    console.log('└' + '─'.repeat(48) + '┘');
  }

  private renderValue(value: any, prefix: string): void {
    if (value === null || value === undefined) {
      console.log(`${prefix}(null)`);
      return;
    }

    if (typeof value === 'object' && 'error' in value) {
      console.log(`${prefix}ERROR: ${value.error}`);
      return;
    }

    // Handle wallet balance
    if (typeof value === 'object' && 'balance' in value) {
      const balance = Number(value.balance);
      const ada = balance / 1_000_000;
      console.log(`${prefix}${balance.toLocaleString()} lovelace (${ada.toFixed(6)} ADA)`);
      return;
    }

    // Handle UTXO arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        console.log(`${prefix}(empty array)`);
      } else {
        console.log(`${prefix}${value.length} items:`);
        value.slice(0, 3).forEach((item, index) => {
          if (this.isUtxo(item)) {
            this.renderUtxo(item, `${prefix}  [${index}] `);
          } else {
            console.log(`${prefix}  [${index}] ${JSON.stringify(item)}`);
          }
        });
        if (value.length > 3) {
          console.log(`${prefix}  ... and ${value.length - 3} more`);
        }
      }
      return;
    }

    // Handle UTXO objects
    if (this.isUtxo(value)) {
      this.renderUtxo(value, prefix);
      return;
    }

    // Handle other objects
    if (typeof value === 'object') {
      console.log(`${prefix}${JSON.stringify(value, null, 2).split('\n').join(`\n${prefix}`)}`);
      return;
    }

    // Handle primitives
    console.log(`${prefix}${value}`);
  }

  private isUtxo(obj: any): boolean {
    return typeof obj === 'object' && obj !== null && 
           'txHash' in obj && 'outputIndex' in obj && 'amount' in obj;
  }

  private renderUtxo(utxo: any, prefix: string): void {
    const amount = Number(utxo.amount);
    const ada = amount / 1_000_000;
    const shortHash = utxo.txHash.slice(0, 8) + '...' + utxo.txHash.slice(-8);
    
    console.log(`${prefix}UTXO ${shortHash}:${utxo.outputIndex}`);
    console.log(`${prefix}  Amount: ${amount.toLocaleString()} lovelace (${ada.toFixed(6)} ADA)`);
    
    if (utxo.datum !== undefined && utxo.datum !== null) {
      console.log(`${prefix}  Datum: ${utxo.datum}`);
    }
    
    if (utxo.address) {
      const shortAddr = utxo.address.slice(0, 12) + '...' + utxo.address.slice(-8);
      console.log(`${prefix}  Address: ${shortAddr}`);
    }
  }

  renderRequestExecution(method: string, endpoint: string, body?: any): void {
    console.log(`\nExecuting: ${method} ${endpoint}`);
    if (body && Object.keys(body).length > 0) {
      console.log('Request body:', JSON.stringify(body, null, 2));
    }
  }

  renderResponse(statusCode: number, data: any): void {
    console.log(`Response (${statusCode}):`, JSON.stringify(data, null, 2));
  }

  renderStepSummary(result: StepResult): void {
    console.log(`\nStep completed in ${result.executionTime}ms`);
    
    if (result.statusCode >= 400) {
      console.log(`❌ Failed with status ${result.statusCode}`);
    } else {
      console.log(`✅ Success (${result.statusCode})`);
    }
  }

  renderExecutionSummary(results: StepResult[]): void {
    console.log('\n' + '='.repeat(60));
    console.log('EXECUTION SUMMARY');
    console.log('='.repeat(60));
    
    const totalTime = results.reduce((sum, result) => sum + result.executionTime, 0);
    const successCount = results.filter(result => result.statusCode < 400).length;
    const failureCount = results.length - successCount;
    
    console.log(`Total steps: ${results.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Failed: ${failureCount}`);
    console.log(`Total execution time: ${totalTime}ms`);
    
    if (failureCount === 0) {
      console.log('\n✅ All steps completed successfully!');
    } else {
      console.log('\n❌ Some steps failed. Check the output above for details.');
    }
    
    console.log('='.repeat(60));
  }
}