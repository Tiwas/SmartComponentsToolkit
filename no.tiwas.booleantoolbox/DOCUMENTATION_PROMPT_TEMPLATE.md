# Documentation Prompt Template

## Purpose
This prompt template is designed to be reused across projects to establish consistent documentation standards and AI assistant behavior guidelines.

## The Prompt

---

I need to get this project documented. Therefore, I want you to go through all code files and:

1. Explain each function and place this as a comment before the function itself

2. Together with the explanation, list all functions that directly and indirectly call this function

3. Create a separate file that explains the project as a whole, what each file in the project does. There must also be a dependency map for the project.

4. Add instructions to robots.md (or CLAUDE.md / CONTRIBUTING.md) for keeping this updated for each session.

5. All comments and documentation must be in English.

6. Add to robots.md that all code must compile before being presented as a solution.

7. Add to robots.md that existing code must not be modified.

8. Add to robots.md that breaking changes must ALWAYS be avoided, and where not possible, must be thoroughly discussed with the user before being made - even when permission to write freely without code approval has been given.

9. Save this prompt for later use in a suitable file for future use in other projects.

---

## Expected Output

When this prompt is executed, the AI should:

### 1. Function Documentation
Add JSDoc-style comments before each function including:
- Description of what the function does
- @param tags for parameters
- @returns tag for return value
- "Called by:" section listing all callers
- "Calls:" section listing all functions called

Example:
```javascript
/**
 * Calculates the total price including tax.
 *
 * Takes a base price and applies the configured tax rate to calculate
 * the final price the customer will pay.
 *
 * @param {number} basePrice - The price before tax
 * @param {number} taxRate - The tax rate as a decimal (e.g., 0.25 for 25%)
 * @returns {number} The total price including tax
 *
 * Called by:
 *   - checkout() in cart.js - When finalizing an order
 *   - displayCart() in display.js - When showing cart totals
 *
 * Calls:
 *   - roundToTwoDecimals() in utils.js - For currency formatting
 */
function calculateTotalPrice(basePrice, taxRate) {
  // implementation
}
```

### 2. Project Documentation File
Create PROJECT_DOCUMENTATION.md containing:
- High-level architecture overview
- ASCII diagram of component relationships
- File structure with descriptions
- Detailed module descriptions
- Dependency map (what imports what)
- Data structures/schemas
- Communication flows (for extensions/APIs)
- Build process
- Security considerations
- Critical findings shall be reported to the user
- This file shall be included in the .gitignore file
- Orphaned functions shall be reported to the user
- Ensure documentation is not pushed to git

### 3. AI Instructions File
Update robots.md (or create CLAUDE.md) with:
- Core principles (complete code, no breaking changes, etc.)
- Documentation maintenance instructions
- Code quality guidelines
- Session workflow (start/end procedures)

## Files Created

When this template is executed on a project, the following files are created:

1. **robots.md** (or CLAUDE.md)
   - AI assistant behavioral guidelines
   - Documentation maintenance procedures
   - Code quality requirements

2. **PROJECT_DOCUMENTATION.md**
   - Architecture overview
   - File descriptions
   - Dependency map
   - Data structures

3. **DOCUMENTATION_PROMPT_TEMPLATE.md** (this file)
   - Reusable prompt for other projects

4. Updated **.gitignore**
   - Excludes PROJECT_DOCUMENTATION.md from version control

## Usage

To use this template on a new project:

1. Copy this file to your new project
2. Open a conversation with your AI assistant
3. Paste the prompt from "The Prompt" section above
4. The AI will analyze your codebase and create the documentation

## Customization

Feel free to modify this template to suit your specific needs:
- Add project-specific guidelines to robots.md
- Adjust the documentation format
- Add additional sections to PROJECT_DOCUMENTATION.md
- Modify the function documentation style

---

*Template version: 1.0*
*Created: December 2024*
