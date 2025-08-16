const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

/**
 * ScopeManager handles persistent variable scope across code blocks
 * using a two-pass approach with AST parsing for robust variable tracking.
 */
class ScopeManager {
  constructor(monadicFunctions = {}) {
    this.knownScopeVars = new Set();
    this.scope = { ...monadicFunctions }; // Initialize with monadic functions
  }

  /**
   * Pass 1: Collect all free variable assignments across all code blocks
   * @param {string[]} codeBlocks - Array of code strings
   * @returns {Set<string>} Set of variable names that should persist in scope
   */
  collectAssignedFreeVars(codeBlocks) {
    const assigned = new Set();

    for (const code of codeBlocks) {
      try {
        const ast = parser.parse(code, {
          sourceType: 'module',
          plugins: ['topLevelAwait'],
          allowReturnOutsideFunction: true,
          allowImportExportEverywhere: true
        });

        traverse(ast, {
          AssignmentExpression(path) {
            const left = path.node.left;

            // Handle simple assignments: variable = expression
            if (t.isIdentifier(left)) {
              // Check if this is a free variable (not declared in current scope)
              if (!path.scope.hasBinding(left.name)) {
                assigned.add(left.name);
              }
            }

            // Handle destructuring assignments: [x, y] = expression
            if (t.isArrayPattern(left)) {
              for (const elem of left.elements) {
                if (t.isIdentifier(elem) && !path.scope.hasBinding(elem.name)) {
                  assigned.add(elem.name);
                }
              }
            }

            // Handle object destructuring: {x, y} = expression
            if (t.isObjectPattern(left)) {
              for (const prop of left.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.value) && !path.scope.hasBinding(prop.value.name)) {
                  assigned.add(prop.value.name);
                }
              }
            }
          },

          // Handle compound assignments: variable += expression
          UpdateExpression(path) {
            const argument = path.node.argument;
            if (t.isIdentifier(argument) && !path.scope.hasBinding(argument.name)) {
              assigned.add(argument.name);
            }
          }
        });
      } catch (error) {
        console.warn('Failed to parse code block for variable collection:', error.message);
      }
    }

    return assigned;
  }

  /**
   * Pass 2: Rewrite code to use scope.variable for known variables
   * @param {string} code - Code string to rewrite
   * @param {Set<string>} knownScopeVars - Set of known scope variables
   * @returns {string} Rewritten code
   */
  rewriteCodeWithKnownScope(code, knownScopeVars) {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['topLevelAwait']
      });

      traverse(ast, {
        Identifier(path) {
          const name = path.node.name;

          // Only rewrite if it's a known "global" and free
          const isFree = !path.scope.hasBinding(name);

          // Skip property keys in object literals
          const isPropertyKey =
            t.isObjectProperty(path.parent) &&
            path.parent.key === path.node &&
            !path.parent.computed;

          // Skip object.member (e.g., jeff.wallet)
          const isMemberProperty =
            t.isMemberExpression(path.parent) &&
            path.parent.property === path.node &&
            !path.parent.computed;

          if (
            isFree &&
            !isPropertyKey &&
            !isMemberProperty &&
            knownScopeVars.has(name)
          ) {
            path.replaceWith(
              t.memberExpression(t.identifier('scope'), t.identifier(name))
            );
          }
        }
      });

      const { code: output } = generate(ast);
      return output;
    } catch (error) {
      console.warn('Failed to rewrite code, returning original:', error.message);
      return code;
    }
  }

  /**
   * Initialize scope with all known variables set to undefined
   * @param {Set<string>} knownScopeVars - Set of variable names
   */
  initializeScope(knownScopeVars) {
    this.knownScopeVars = knownScopeVars;
    
    // Preserve existing initial bindings (like monadic functions)
    const existingBindings = { ...this.scope };
    
    // Reset scope and add back initial bindings
    this.scope = { ...existingBindings };
    
    for (const varName of knownScopeVars) {
      this.scope[varName] = undefined;
    }
  }

  /**
   * Process multiple code blocks and return rewritten versions
   * @param {string[]} codeBlocks - Array of code strings
   * @returns {string[]} Array of rewritten code strings
   */
  processCodeBlocks(codeBlocks) {
    // Pass 1: Collect all assigned free variables
    const assignedFreeVars = this.collectAssignedFreeVars(codeBlocks);
    
    // Initialize scope with assigned variables
    this.initializeScope(assignedFreeVars);
    
    // Create the complete set of known variables (assigned + existing in scope)
    const allKnownVars = new Set([...assignedFreeVars, ...Object.keys(this.scope)]);
    
    // Pass 2: Rewrite each code block using the complete set
    const rewrittenBlocks = codeBlocks.map(code => 
      this.rewriteCodeWithKnownScope(code, allKnownVars)
    );
    
    return rewrittenBlocks;
  }
  
  /**
   * Process multiple code blocks with existing scope (for dry runs)
   * @param {string[]} codeBlocks - Array of code strings
   * @param {Object} existingScope - Existing scope object
   * @returns {string[]} Array of rewritten code strings
   */
  processCodeBlocksWithExistingScope(codeBlocks, existingScope) {
    // Pass 1: Collect all assigned free variables
    const assignedFreeVars = this.collectAssignedFreeVars(codeBlocks);
    
    // Use existing scope but ensure all known variables exist
    this.scope = { ...existingScope };
    for (const varName of assignedFreeVars) {
      if (!(varName in this.scope)) {
        this.scope[varName] = undefined;
      }
    }
    this.knownScopeVars = assignedFreeVars;
    
    // Create the complete set of known variables (assigned + existing in scope)
    const allKnownVars = new Set([...assignedFreeVars, ...Object.keys(this.scope)]);
    
    // Pass 2: Rewrite each code block using the complete set
    const rewrittenBlocks = codeBlocks.map(code => 
      this.rewriteCodeWithKnownScope(code, allKnownVars)
    );
    
    return rewrittenBlocks;
  }

  /**
   * Get the current scope object
   * @returns {Object} Current scope
   */
  getScope() {
    return this.scope;
  }

  /**
   * Add monadic functions to the scope
   * @param {Object} monadicFunctions - Object containing monadic functions
   */
  addMonadicFunctions(monadicFunctions) {
    Object.assign(this.scope, monadicFunctions);
  }
}

module.exports = { ScopeManager };
