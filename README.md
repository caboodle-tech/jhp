# JS Hypertext Preprocessor (JHP)

## Introduction

JS Hypertext Preprocessor (JHP) is a **developer-focused JavaScript templating engine** designed to rival static site generators by leveraging **native JavaScript** instead of introducing custom templating syntaxes. Inspired by PHP, JHP allows developers to use raw` HTML and familiar JavaScript to build dynamic templates for static site generation during local development.

**Note:** JHP is not intended to be used as a production server due to potential security concerns. It is best suited for local development environments and static site generation workflows.

## Features

- Use **native HTML and JavaScript** for templating.
- Supports **PHP-like behaviors**, such as variable redeclaration across script blocks.
- Provides a simplified **output buffering system** with `$obOpen` and `$obClose`.
- Includes flexible **file inclusion** for partials and reusable templates.
- Prevents unsafe operations with built-in security checks.

## How It Works

JHP processes files (commonly `.jhp` files) containing raw HTML with `<script>` blocks, transforming them into static HTML. The engine specifically executes `<script>` tags **without attributes** in a server-side context, enabling dynamic content generation. To include frontend JavaScript intended for the browser, ensure your `<script>` tags have at least one attribute (e.g., `<script type="text/javascript">`), as JHP will ignore such tags.

This flexibility allows developers to:
- Use built-in `$` functions within server-side `<script>` blocks to manage output, include files, or define constants.
- Declare variables or functions in one `<script>` block and reuse them in later blocks, maintaining context across the file.
- Capture and reuse parts of the output with the output buffer.
- Modularize templates with nested file includes.

## Example Setup

This example illustrates JHP's capabilities, including variable handling, file inclusion, default values, constants, and output buffering. While your project may use a different templating style or structure, this example is designed to highlight the engine's features and emulate PHP-like behavior.

### File Structure

```
project/
|-- templates/
|   |-- header.html
|   |-- footer.html
|-- index.html
```

### `index.html`

```html
<script>
    $obOpen();
</script>

The home page's content here...

<script>
    const mainContent = $obClose();
    $echo($include('./templates/primary.html'));
</script>
```

### `templates/primary.html`

```html
<script>
    $default('pageTitle', 'Home Page');
    $default('description', 'Welcome to our amazing site!');

    $echo($include('./partials/header.html'));
    $echo(`<main class="content-grid">${mainContent}</main>`);
    $echo($include('./partials/footer.html'));
</script>
```

### `partials/header.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><script>$echo(pageTitle);</script></title>
</head>
<body>
<header>
    <h1><script>$echo(pageTitle);</script></h1>
</header>
```

### `partials/footer.html`

```html
<footer>
    <p>
        &copy; 2025 <script>$echo(companyName);</script>. All rights reserved.
    </p>
</footer>
</body>
</html>
```

### Resulting Output

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home Page</title>
</head>
<body>
<header>
    <h1>Home Page</h1>
</header>
<main class="content-grid">
    The home page's content here...
</main>
<footer>
    <p>
        &copy; 2025 Caboodle Tech Inc. All rights reserved.
    </p>
</footer>
</body>
</html>
```

## Built-in `$` Functions

The `$` object provides several utility methods for use in templates:

Function | Description
---|---
`$context(key, value)` | Adds or updates a variables value in the current context. Used internally but can be used to preemptively load variables.
`$define(key, value)`  | Defines a true constant variable. Displays an error if redefined in any context.
`$default(key, value)` | Sets a default value for a variable if it is not already defined.
`$echo(...args)`       | Outputs content directly to the compiled page.
`$include(file)`       | Includes another file (template) and processes it within the current context; use relative paths.
`$obOpen()`            | Starts an output buffer to capture content.
`$obClose()`           | Closes the output buffer and returns its content as a string.
`$obStatus()`          | Checks if the output buffer is currently open.
`$version()`           | Returns the JHP version string.

## Installation

To use JHP, include it as part of your build process or local development environment. Example usage in a Node.js script:

```js
import JHP from 'jhp';

const jhp = new JHP();
const result = jhp.process('./index.html', null, './');
console.log(result);
```

## Caution

JHP is designed for local development only. While it is technically possible to use it as a production server, **this is not recommended** due to limited security safeguards against malicious code and lack of optimization for high-traffic environments. For production, generate static HTML files using JHP and serve them with a proper web server.

## Why Choose JHP?

- **Familiar and fast:** Use native HTML, CSS, and JavaScript—no need for custom templating languages or complex configurations. Just write and build.
- **Lightweight and focused:** With only one development dependency (acorn), JHP is far simpler than engines requiring multiple plugins or libraries.
- **Flexible structure:** No rigid directory or file structure is enforced—organize your project in a way that works best for you.
- **Encourages native development:** Fully leverage HTML, CSS, and JavaScript as they are, with support for modern CSS features like nesting. JHP doesn’t require preprocessing tools but allows seamless integration if your project needs them.
- **Modular and maintainable:** Reuse components with file includes and shared templates to keep your code clean and scalable.

JHP streamlines static site generation, empowering developers to build quickly and intuitively without the overhead of traditional templating engines.



