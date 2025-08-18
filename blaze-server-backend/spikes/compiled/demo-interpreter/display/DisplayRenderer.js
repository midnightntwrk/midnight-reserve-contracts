"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplayRenderer = void 0;
/**
 * Display Renderer for before/after state visualization
 * Creates structured console output with boxes and comparisons
 */
class DisplayRenderer {
    renderStepHeader(stepIndex, stepName, description) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`STEP ${stepIndex}: ${stepName}`);
        if (description) {
            console.log(`Description: ${description}`);
        }
        console.log('='.repeat(60));
    }
    renderStateComparison(beforeState, afterState) {
        if (Object.keys(beforeState.data).length === 0)
            return;
        console.log('\n--- STATE MONITORING ---');
        for (const [queryName, beforeValue] of Object.entries(beforeState.data)) {
            const afterValue = afterState.data[queryName];
            this.renderStateQuery(queryName, beforeValue, afterValue);
        }
    }
    renderStateQuery(name, beforeValue, afterValue) {
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
    renderValue(value, prefix) {
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
            const ada = balance / 1000000;
            console.log(`${prefix}${balance.toLocaleString()} lovelace (${ada.toFixed(6)} ADA)`);
            return;
        }
        // Handle UTXO arrays
        if (Array.isArray(value)) {
            if (value.length === 0) {
                console.log(`${prefix}(empty array)`);
            }
            else {
                console.log(`${prefix}${value.length} items:`);
                value.slice(0, 3).forEach((item, index) => {
                    if (this.isUtxo(item)) {
                        this.renderUtxo(item, `${prefix}  [${index}] `);
                    }
                    else {
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
    isUtxo(obj) {
        return typeof obj === 'object' && obj !== null &&
            'txHash' in obj && 'outputIndex' in obj && 'amount' in obj;
    }
    renderUtxo(utxo, prefix) {
        const amount = Number(utxo.amount);
        const ada = amount / 1000000;
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
    renderRequestExecution(method, endpoint, body) {
        console.log(`\nExecuting: ${method} ${endpoint}`);
        if (body && Object.keys(body).length > 0) {
            console.log('Request body:', JSON.stringify(body, null, 2));
        }
    }
    renderResponse(statusCode, data) {
        console.log(`Response (${statusCode}):`, JSON.stringify(data, null, 2));
    }
    renderStepSummary(result) {
        console.log(`\nStep completed in ${result.executionTime}ms`);
        if (result.statusCode >= 400) {
            console.log(`❌ Failed with status ${result.statusCode}`);
        }
        else {
            console.log(`✅ Success (${result.statusCode})`);
        }
    }
    renderExecutionSummary(results) {
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
        }
        else {
            console.log('\n❌ Some steps failed. Check the output above for details.');
        }
        console.log('='.repeat(60));
    }
}
exports.DisplayRenderer = DisplayRenderer;
