/**
 * AST-Based Formula Evaluator
 *
 * Securely evaluates boolean formulas without using eval() or new Function()
 * by parsing expressions into an Abstract Syntax Tree (AST) and evaluating it.
 * This is the core security feature of the Boolean Toolbox - all formula evaluation
 * goes through this class to prevent code injection attacks.
 *
 * Supported operators:
 * - AND: AND, &&, *, &
 * - OR: OR, ||, +, |
 * - XOR: XOR, ^, !=
 * - NOT: NOT, !
 *
 * Supported values:
 * - Variables: A-J (case-insensitive), or namespaced variables (F_FORMULA_1_A)
 * - Literals: TRUE, FALSE, true, false, 1, 0
 * - Parentheses: ( )
 *
 * Called by:
 *   - BaseLogicUnit.evaluateFormula() - Primary formula evaluation
 *   - BaseLogicUnit.validateExpression() - Syntax validation
 *   - logic-device/device.js - Logic Device formula evaluation
 *
 * @class FormulaEvaluator
 */
class FormulaEvaluator {
  /**
   * Creates a new FormulaEvaluator instance.
   * Initializes internal state for tokenization and parsing.
   *
   * Called by:
   *   - BaseLogicUnit.onInit() - Creates evaluator for each device
   *   - logic-device/device.js onInit() - Creates evaluator for logic devices
   */
  constructor() {
    this.tokens = [];
    this.position = 0;
  }

  /**
   * Tokenizes the expression string into an array of token objects.
   *
   * Breaks down the input expression into discrete tokens representing
   * operators (AND, OR, XOR, NOT), parentheses, variables, and literals.
   * Supports multiple syntax variants for each operator type.
   *
   * @param {string} expression - The formula expression to tokenize
   * @returns {Array<{type: string, value: any}>} Array of token objects
   * @throws {Error} If expression is empty, null, or contains invalid characters
   *
   * Called by:
   *   - FormulaEvaluator.evaluate() - First step of evaluation pipeline
   *
   * Calls:
   *   - (none - standalone tokenizer)
   */
  tokenize(expression) {
    if (!expression || typeof expression !== 'string') {
      throw new Error('Expression must be a non-empty string');
    }

    const tokens = [];
    const expr = expression.trim();
    let i = 0;

    while (i < expr.length) {
      // Skip whitespace
      if (/\s/.test(expr[i])) {
        i++;
        continue;
      }

      // Parentheses
      if (expr[i] === '(') {
        tokens.push({ type: 'LPAREN', value: '(' });
        i++;
        continue;
      }
      if (expr[i] === ')') {
        tokens.push({ type: 'RPAREN', value: ')' });
        i++;
        continue;
      }

      // Two-character operators
      if (i < expr.length - 1) {
        const twoChar = expr.substring(i, i + 2);
        if (twoChar === '&&') {
          tokens.push({ type: 'AND', value: '&&' });
          i += 2;
          continue;
        }
        if (twoChar === '||') {
          tokens.push({ type: 'OR', value: '||' });
          i += 2;
          continue;
        }
        if (twoChar === '!=') {
          tokens.push({ type: 'XOR', value: '!=' });
          i += 2;
          continue;
        }
      }

      // Single-character operators
      if (expr[i] === '&') {
        tokens.push({ type: 'AND', value: '&' });
        i++;
        continue;
      }
      if (expr[i] === '*') {
        tokens.push({ type: 'AND', value: '*' });
        i++;
        continue;
      }
      if (expr[i] === '|') {
        tokens.push({ type: 'OR', value: '|' });
        i++;
        continue;
      }
      if (expr[i] === '+') {
        tokens.push({ type: 'OR', value: '+' });
        i++;
        continue;
      }
      if (expr[i] === '^') {
        tokens.push({ type: 'XOR', value: '^' });
        i++;
        continue;
      }
      if (expr[i] === '!') {
        tokens.push({ type: 'NOT', value: '!' });
        i++;
        continue;
      }

      
      // Keywords and variables (utvidet: [A-Z][A-Z0-9_]*)
      if (/[a-zA-Z]/.test(expr[i])) {

        let word = '';
        while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
          word += expr[i];
          i++;
        }

        const upper = word.toUpperCase();
        
        // Keywords
        if (upper === 'AND') {
          tokens.push({ type: 'AND', value: 'AND' });
        } else if (upper === 'OR') {
          tokens.push({ type: 'OR', value: 'OR' });
        } else if (upper === 'XOR') {
          tokens.push({ type: 'XOR', value: 'XOR' });
        } else if (upper === 'NOT') {
          tokens.push({ type: 'NOT', value: 'NOT' });
        } else if (upper === 'TRUE') {
          tokens.push({ type: 'LITERAL', value: true });
        } else if (upper === 'FALSE') {
          tokens.push({ type: 'LITERAL', value: false });
        
        } else if (/^[A-J]$/.test(upper) || /^[A-Z][A-Z0-9_]*$/.test(upper)) {
          // Variabler: enten en enkel A–J, eller et namespacet navn (F_FORMULA_1_A)
          tokens.push({ type: 'VARIABLE', value: upper });
        } else {
          throw new Error(`Invalid identifier: ${word}`);
        }

        continue;
      }

      // Numbers (0 or 1 as boolean literals)
      if (/[0-9]/.test(expr[i])) {
        const num = expr[i];
        if (num === '0') {
          tokens.push({ type: 'LITERAL', value: false });
        } else if (num === '1') {
          tokens.push({ type: 'LITERAL', value: true });
        } else {
          throw new Error(`Invalid number: ${num}. Only 0 and 1 are allowed.`);
        }
        i++;
        continue;
      }

      // Unknown character
      throw new Error(`Unexpected character: ${expr[i]}`);
    }

    return tokens;
  }

  /**
   * Parses an array of tokens into an Abstract Syntax Tree (AST).
   *
   * Implements a recursive descent parser following operator precedence:
   * OR (lowest) -> XOR -> AND -> NOT (highest)
   * This ensures expressions like "A AND B OR C" are parsed correctly as "(A AND B) OR C".
   *
   * @param {Array<{type: string, value: any}>} tokens - Array of tokens from tokenize()
   * @returns {Object} AST root node with type, operator, and left/right or operand properties
   * @throws {Error} If tokens array is empty or contains syntax errors
   *
   * Called by:
   *   - FormulaEvaluator.evaluate() - Second step of evaluation pipeline
   *
   * Calls:
   *   - FormulaEvaluator.parseOr() - Starts the recursive descent parsing
   */
  parse(tokens) {
    this.tokens = tokens;
    this.position = 0;

    if (tokens.length === 0) {
      throw new Error('Empty expression');
    }

    const ast = this.parseOr();

    if (this.position < this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.position].value}`);
    }

    return ast;
  }

  /**
   * Parses OR expressions (lowest precedence in the grammar).
   *
   * Handles OR operators by building a left-associative binary tree.
   * Delegates to parseXor() for higher precedence operations.
   *
   * @returns {Object} AST node representing the OR expression
   *
   * Called by:
   *   - FormulaEvaluator.parse() - Entry point for parsing
   *   - FormulaEvaluator.parsePrimary() - For parenthesized sub-expressions
   *
   * Calls:
   *   - FormulaEvaluator.parseXor() - For higher precedence XOR operations
   */
  parseOr() {
    let left = this.parseXor();

    while (this.position < this.tokens.length && this.tokens[this.position].type === 'OR') {
      this.position++;
      const right = this.parseXor();
      left = {
        type: 'BinaryOp',
        operator: 'OR',
        left: left,
        right: right
      };
    }

    return left;
  }

  /**
   * Parses XOR expressions (medium precedence).
   *
   * Handles XOR operators by building a left-associative binary tree.
   * Delegates to parseAnd() for higher precedence operations.
   *
   * @returns {Object} AST node representing the XOR expression
   *
   * Called by:
   *   - FormulaEvaluator.parseOr() - When parsing OR expressions
   *
   * Calls:
   *   - FormulaEvaluator.parseAnd() - For higher precedence AND operations
   */
  parseXor() {
    let left = this.parseAnd();

    while (this.position < this.tokens.length && this.tokens[this.position].type === 'XOR') {
      this.position++;
      const right = this.parseAnd();
      left = {
        type: 'BinaryOp',
        operator: 'XOR',
        left: left,
        right: right
      };
    }

    return left;
  }

  /**
   * Parses AND expressions (higher precedence than OR/XOR).
   *
   * Handles AND operators by building a left-associative binary tree.
   * Delegates to parseUnary() for highest precedence operations (NOT).
   *
   * @returns {Object} AST node representing the AND expression
   *
   * Called by:
   *   - FormulaEvaluator.parseXor() - When parsing XOR expressions
   *
   * Calls:
   *   - FormulaEvaluator.parseUnary() - For NOT operators and primary expressions
   */
  parseAnd() {
    let left = this.parseUnary();

    while (this.position < this.tokens.length && this.tokens[this.position].type === 'AND') {
      this.position++;
      const right = this.parseUnary();
      left = {
        type: 'BinaryOp',
        operator: 'AND',
        left: left,
        right: right
      };
    }

    return left;
  }

  /**
   * Parses unary expressions (NOT operator - highest precedence).
   *
   * Handles the NOT operator and recursively allows for multiple consecutive
   * NOT operators (e.g., "NOT NOT A" which evaluates to A).
   *
   * @returns {Object} AST node representing the unary expression
   *
   * Called by:
   *   - FormulaEvaluator.parseAnd() - When parsing AND expressions
   *   - FormulaEvaluator.parseUnary() - Recursively for multiple NOTs
   *
   * Calls:
   *   - FormulaEvaluator.parseUnary() - Recursively for the operand
   *   - FormulaEvaluator.parsePrimary() - For non-NOT expressions
   */
  parseUnary() {
    if (this.position < this.tokens.length && this.tokens[this.position].type === 'NOT') {
      this.position++;
      const operand = this.parseUnary(); // Allow multiple NOTs
      return {
        type: 'UnaryOp',
        operator: 'NOT',
        operand: operand
      };
    }

    return this.parsePrimary();
  }

  /**
   * Parses primary expressions (the leaves of the AST).
   *
   * Handles:
   * - Parenthesized sub-expressions: "(A AND B)"
   * - Boolean literals: TRUE, FALSE, 1, 0
   * - Variables: A-J or namespaced names like F_FORMULA_1_A
   *
   * @returns {Object} AST node representing the primary expression
   * @throws {Error} If unexpected token is encountered or parentheses are unbalanced
   *
   * Called by:
   *   - FormulaEvaluator.parseUnary() - For non-NOT expressions
   *
   * Calls:
   *   - FormulaEvaluator.parseOr() - For parenthesized sub-expressions (back to lowest precedence)
   */
  parsePrimary() {
    if (this.position >= this.tokens.length) {
      throw new Error('Unexpected end of expression');
    }

    const token = this.tokens[this.position];

    // Parentheses
    if (token.type === 'LPAREN') {
      this.position++;
      const expr = this.parseOr();
      if (this.position >= this.tokens.length || this.tokens[this.position].type !== 'RPAREN') {
        throw new Error('Unbalanced parentheses');
      }
      this.position++;
      return expr;
    }

    // Literals
    if (token.type === 'LITERAL') {
      this.position++;
      return {
        type: 'Literal',
        value: token.value
      };
    }

    // Variables
    if (token.type === 'VARIABLE') {
      this.position++;
      return {
        type: 'Variable',
        name: token.value
      };
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  /**
   * Recursively evaluates an Abstract Syntax Tree with given variable values.
   *
   * Traverses the AST and computes the boolean result based on node types:
   * - Literal: Returns the literal boolean value
   * - Variable: Looks up the value in the variables object
   * - UnaryOp (NOT): Negates the operand
   * - BinaryOp (AND/OR/XOR): Applies the operator to left and right children
   *
   * @param {Object} ast - The AST node to evaluate
   * @param {Object} variables - Object mapping variable names (uppercase) to boolean values
   * @returns {boolean} The result of the evaluation
   * @throws {Error} If a variable is undefined or AST contains unknown node types
   *
   * Called by:
   *   - FormulaEvaluator.evaluate() - Final step of evaluation pipeline
   *   - FormulaEvaluator.evaluateAST() - Recursively for sub-expressions
   *
   * Calls:
   *   - FormulaEvaluator.evaluateAST() - Recursively for child nodes
   */
  evaluateAST(ast, variables = {}) {
    if (!ast) {
      throw new Error('Invalid AST');
    }

    switch (ast.type) {
      case 'Literal':
        return !!ast.value;

      case 'Variable':
        const val = variables[ast.name];
        // Throw error if variable is not defined - don't treat it as false
        if (val === undefined || val === "undefined") {
          throw new Error(`Variable ${ast.name} is not defined`);
        }
        return !!val;

      case 'UnaryOp':
        if (ast.operator === 'NOT') {
          return !this.evaluateAST(ast.operand, variables);
        }
        throw new Error(`Unknown unary operator: ${ast.operator}`);

      case 'BinaryOp':
        const left = this.evaluateAST(ast.left, variables);
        const right = this.evaluateAST(ast.right, variables);

        switch (ast.operator) {
          case 'AND':
            return left && right;
          case 'OR':
            return left || right;
          case 'XOR':
            return left !== right;
          default:
            throw new Error(`Unknown binary operator: ${ast.operator}`);
        }

      default:
        throw new Error(`Unknown AST node type: ${ast.type}`);
    }
  }

  /**
   * Main entry point: validates and evaluates a boolean expression.
   *
   * This is the primary method used by external code to evaluate formulas.
   * It combines tokenization, parsing, and AST evaluation into a single call.
   * The three-step pipeline ensures secure evaluation without using eval().
   *
   * @param {string} expression - The formula expression (e.g., "A AND B OR NOT C")
   * @param {Object} variables - Object mapping variable names to boolean values
   *                             Example: { A: true, B: false, C: true }
   * @returns {boolean} The result of the boolean expression evaluation
   * @throws {Error} If expression is invalid or contains undefined variables
   *
   * Called by:
   *   - BaseLogicUnit.evaluateFormula() - Primary formula evaluation
   *   - BaseLogicUnit.validateExpression() - For syntax validation (catches errors)
   *   - logic-device/device.js - Logic Device formula evaluation
   *
   * Calls:
   *   - FormulaEvaluator.tokenize() - Step 1: Convert string to tokens
   *   - FormulaEvaluator.parse() - Step 2: Convert tokens to AST
   *   - FormulaEvaluator.evaluateAST() - Step 3: Evaluate AST with variables
   */
  evaluate(expression, variables = {}) {
    const tokens = this.tokenize(expression);
    const ast = this.parse(tokens);
    return this.evaluateAST(ast, variables);
  }
}

module.exports = FormulaEvaluator;