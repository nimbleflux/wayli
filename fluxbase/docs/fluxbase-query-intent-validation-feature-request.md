# Feature Request: Query Intent Validation for Fluxbase Chatbots

## Context

**Fluxbase** is a Backend-as-a-Service platform (similar to Supabase) that provides AI chatbot capabilities. Applications built on Fluxbase can define chatbots with:
- System prompts (LLM instructions)
- Tool definitions (execute_sql, http_request, etc.)
- Annotations for access control (@fluxbase:allowed-tables, @fluxbase:rate-limit, etc.)

**The Problem**: LLMs sometimes generate SQL queries that use the WRONG table for the user's intent, even when the system prompt instructs otherwise. Prompt engineering alone isn't reliable.

## Example Problem (from a Fluxbase customer)

A travel app has a chatbot with these tables:
- `my_place_visits` - Venue visits (restaurants, museums, etc.) with columns: poi_name, poi_amenity, city
- `my_trips` - Trip metadata (trip titles like "Japan 2024") with columns: title, description, dates

When user asks "What restaurant did I visit?", the LLM generates:
```sql
SELECT title FROM my_trips WHERE title ILIKE '%restaurant%'  -- WRONG!
```

Instead of:
```sql
SELECT poi_name FROM my_place_visits WHERE poi_amenity ILIKE '%restaurant%'  -- CORRECT!
```

The chatbot's system prompt has extensive instructions, but LLMs don't reliably follow them.

## Feature Request: Query Intent Validation

Add platform-level query validation that enforces correct table usage based on user intent.

---

## Proposed Solution: New Chatbot Annotations

### 1. New Annotation: `@fluxbase:intent-rules`

Allow chatbot developers to define keyword -> table mapping rules:

```typescript
/**
 * @fluxbase:intent-rules [
 *   { "keywords": ["restaurant", "cafe", "food", "eat"], "requiredTable": "my_place_visits", "forbiddenTable": "my_trips" },
 *   { "keywords": ["trip", "travel", "vacation"], "requiredTable": "my_trips" }
 * ]
 */
```

### 2. New Annotation: `@fluxbase:required-columns`

Ensure specific columns are always included when querying a table:

```typescript
/**
 * @fluxbase:required-columns my_trips=id,title,image_url
 */
```

### 3. New Annotation: `@fluxbase:default-table`

Set a default table that should be used unless explicitly needed otherwise:

```typescript
/**
 * @fluxbase:default-table my_place_visits
 */
```

---

## Implementation in Fluxbase Platform

### 1. Query Intent Validator Module

Add to the Fluxbase AI engine (where `execute_sql` tool calls are processed):

```typescript
/**
 * Query Intent Validator
 * Validates LLM-generated SQL queries against chatbot's intent rules
 */

interface IntentRule {
  keywords: string[];
  requiredTable: string;
  forbiddenTable?: string;
}

interface ChatbotConfig {
  intentRules?: IntentRule[];
  requiredColumns?: Record<string, string[]>;
  defaultTable?: string;
}

function validateQueryIntent(
  userMessage: string,
  sqlQuery: string,
  config: ChatbotConfig
): { valid: boolean; error?: string; suggestedTable?: string } {

  if (!config.intentRules) return { valid: true };

  const tableUsed = extractTableFromQuery(sqlQuery);
  if (!tableUsed) return { valid: true };

  const messageLower = userMessage.toLowerCase();

  for (const rule of config.intentRules) {
    const matchesKeyword = rule.keywords.some(k => messageLower.includes(k));

    if (matchesKeyword && rule.forbiddenTable && tableUsed === rule.forbiddenTable) {
      return {
        valid: false,
        error: `Query uses "${tableUsed}" but should use "${rule.requiredTable}" for this intent`,
        suggestedTable: rule.requiredTable
      };
    }
  }

  return { valid: true };
}

function validateRequiredColumns(
  sqlQuery: string,
  config: ChatbotConfig
): { valid: boolean; error?: string; missingColumns?: string[] } {

  if (!config.requiredColumns) return { valid: true };

  const tableUsed = extractTableFromQuery(sqlQuery);
  if (!tableUsed || !config.requiredColumns[tableUsed]) return { valid: true };

  const required = config.requiredColumns[tableUsed];
  const sqlLower = sqlQuery.toLowerCase();

  if (sqlLower.includes('select *')) return { valid: true };

  const missing = required.filter(col => !sqlLower.includes(col.toLowerCase()));

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Query missing required columns: ${missing.join(', ')}`,
      missingColumns: missing
    };
  }

  return { valid: true };
}
```

### 2. Integrate into execute_sql Tool Handler

In the Fluxbase AI engine, when processing `execute_sql` tool calls:

```typescript
async function handleExecuteSqlTool(
  userMessage: string,
  sqlQuery: string,
  chatbotConfig: ChatbotConfig
) {
  // 1. Validate intent
  const intentValidation = validateQueryIntent(userMessage, sqlQuery, chatbotConfig);
  if (!intentValidation.valid) {
    // Option A: Reject and ask LLM to retry with correct table
    return {
      error: intentValidation.error,
      suggestion: `Use ${intentValidation.suggestedTable} instead`
    };

    // Option B: Auto-correct the query
    // const correctedSql = sqlQuery.replace(/FROM\s+\w+/i, `FROM ${intentValidation.suggestedTable}`);
    // return executeQuery(correctedSql);
  }

  // 2. Validate required columns
  const columnValidation = validateRequiredColumns(sqlQuery, chatbotConfig);
  if (!columnValidation.valid) {
    return {
      error: columnValidation.error,
      missingColumns: columnValidation.missingColumns
    };
  }

  // 3. Execute the query
  return executeQuery(sqlQuery);
}
```

### 3. Parse New Annotations

Update the chatbot sync/deployment process to parse the new annotations:

```typescript
function parseChatbotAnnotations(jsdoc: string): ChatbotConfig {
  const config: ChatbotConfig = {};

  // Parse @fluxbase:intent-rules
  const intentRulesMatch = jsdoc.match(/@fluxbase:intent-rules\s+(\[[\s\S]*?\])/);
  if (intentRulesMatch) {
    config.intentRules = JSON.parse(intentRulesMatch[1]);
  }

  // Parse @fluxbase:required-columns
  const requiredColsMatch = jsdoc.match(/@fluxbase:required-columns\s+(\S+)/);
  if (requiredColsMatch) {
    // Format: table1=col1,col2 table2=col3,col4
    config.requiredColumns = parseColumnSpec(requiredColsMatch[1]);
  }

  // Parse @fluxbase:default-table
  const defaultTableMatch = jsdoc.match(/@fluxbase:default-table\s+(\S+)/);
  if (defaultTableMatch) {
    config.defaultTable = defaultTableMatch[1];
  }

  return config;
}
```

---

## Behavior Options

When validation fails, Fluxbase could:

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| **Reject** | Return error to LLM, ask to retry | Clean, explicit | May confuse LLM |
| **Auto-correct** | Silently fix the query | Seamless UX | May break complex queries |
| **Warn** | Execute but log warning | No disruption | Wrong results returned |
| **Inject prompt** | Add correction hint to LLM context | LLM learns | Extra tokens |

**Recommendation**: Start with **Reject + Retry** - return the validation error to the LLM and let it generate a new query with the correct table.

---

## Example Chatbot with New Annotations

```typescript
/**
 * Location Assistant
 *
 * @fluxbase:allowed-tables my_trips,my_place_visits,my_poi_summary
 * @fluxbase:allowed-operations SELECT
 * @fluxbase:default-table my_place_visits
 * @fluxbase:required-columns my_trips=id,title,image_url
 * @fluxbase:intent-rules [
 *   {"keywords":["restaurant","cafe","food","eat","dining"],"requiredTable":"my_place_visits","forbiddenTable":"my_trips"},
 *   {"keywords":["museum","gallery","cinema"],"requiredTable":"my_place_visits","forbiddenTable":"my_trips"},
 *   {"keywords":["golf","tennis","gym","sports"],"requiredTable":"my_place_visits","forbiddenTable":"my_trips"},
 *   {"keywords":["trip","travel","vacation","journey"],"requiredTable":"my_trips"}
 * ]
 */
export default `You are a location assistant...`;
```

---

## Success Criteria

1. Chatbot developers can define intent -> table rules via annotations
2. Fluxbase AI engine validates queries before execution
3. Wrong table usage is rejected with helpful error message
4. Required columns are enforced (e.g., image_url for trips)
5. Validation errors are logged for debugging
6. Backwards compatible - existing chatbots without annotations work unchanged

---

## Implementation Priority

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| 1 | Query Intent Validation | Medium | High - Prevents wrong table usage |
| 2 | Required Columns | Low | Medium - Ensures image_url included |
| 3 | Query Logging | Low | Medium - Visibility for debugging |
| 4 | Multi-Query Enforcement | Medium | High - Richer answers |
| 5 | Column-Level Access | High | Low - Security enhancement |
| 6 | Table Priority Config | Low | Medium - Reduces primacy bias |
