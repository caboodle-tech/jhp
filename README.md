# JS Hypertext Preprocessor (JHP)

## Introduction

JS Hypertext Preprocessor (JHP) is a **developer-focused JavaScript templating engine** designed to rival static site generators by leveraging **native JavaScript** instead of introducing custom templating syntaxes. Inspired by PHP, JHP allows developers to use raw HTML and familiar JavaScript to build dynamic templates for static site generation during local development.

**Important:** JHP is a library that you **integrate into your build process** or server application. It is not a standalone command-line tool. You need to write code that uses JHP to process your template files. See the [Installation](#installation) section for details.

**Note:** JHP can be used as a production server, similar to PHP, but please exercise caution as it has not been fully tested for that use and may have potential security concerns. It is primarily designed for local development environments and static site generation workflows.

## Features

- Use **native HTML and JavaScript** for templating.
- Supports **PHP-like behaviors**, such as variable redeclaration across script blocks.
- Provides a simplified **output buffering system** with `$obOpen` and `$obClose`.
- Includes flexible **file inclusion** for partials and reusable templates.
- Built-in security check that attempt to prevent unsafe code execution.
- Can be used as a **view engine** for server-side rendering.

## How It Works

JHP processes files &ndash; commonly `.jhp` files but you can choose the extension by what file you hand to the engine &ndash; containing raw HTML with special `<script>` blocks, transforming them into static HTML. The engine specifically executes `<script>` tags **without attributes** in a server-side context, enabling dynamic content generation. This flexibility allows developers to:
- Use built-in `$` functions within server-side `<script>` blocks to manage output, include files, or define constants.
- Declare variables or functions in one `<script>` block and reuse them in later blocks, maintaining context across the file.
- Capture and reuse parts of the output with the output buffer.
- Modularize templates with nested file includes.

**Note:** The `<script>` tag is included by default as a JHP tag to ensure code editors automatically highlight and provide IntelliSense for JHP blocks. In the future I hope to add IDE support for `<jhp>` tags.

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
    if (!pageTitle) {
        let title = 'Home Page';
    }
    if (!description) {
        let description = 'Welcome to our amazing site!';
    }

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

**Note:** To include frontend JavaScript for the browser, add at least one attribute to your `<script>` tags (such as `<script type="text/javascript">`). JHP only processes `<script>` tags without attributes; those with attributes are ignored and treated as standard client-side scripts.

## Built-in `$` Functions

The `$` object provides several utility methods for use in templates:

Function | Description
---|---
`$context(key, value)` | Adds or updates a variables value in the current context. Used internally but can be used to preemptively load variables.
`$define(key, value)`  | Defines a true constant variable. Displays an error if redefined in any context.
`$echo(content)`       | Outputs content directly to the compiled page; accepts only one argument.
`$if(<condition>)`     | Starts an if block that may be followed by `$elseif()` or `$else()` blocks.
`$elseif(<condition>)` | Provides an alternative condition for an if block. May be followed by another `$elseif()` or `$else()` block.
`$else()`              | The default block for an if or if-elseif statement if no other conditions are met.
`$end()`               | Ends a conditional block. Must be used after `$if()`, `$elseif()`, or `$else()` to properly close the conditional block.
`$include(file)`       | Includes another file (template) and processes it within the current context; use relative paths.
`$obOpen()`            | Starts an output buffer to capture content.
`$obClose()`           | Closes the output buffer and returns its content as a string.
`$obStatus()`          | Checks if the output buffer is currently open.
`$version()`           | Returns the JHP version string.

For more information on how to properly use these functions, refer to the [example files](./examples/src/) in the `examples` directory.

## Installation

JHP is not a standalone tool &ndash; you need to **integrate it into your build process** or server application. You can use JHP in two ways:

### Option 1: Install via npm (Recommended)

Install JHP as an npm package:

```bash
npm install @caboodle-tech/jhp
```

Then import it in your project:

```js
import JHP from '@caboodle-tech/jhp';

const jhp = new JHP(); // <-- This accepts the same options {} as the process method
const html = jhp.process('./template.jhp');
console.log(html);
```

### Option 2: Copy Source Files (Manual)

If you prefer to manually include JHP in your project, you can copy the files from the `src` directory directly into your project. You only need:
- `src/jhp.js`
- `src/processors.js`

Then import and use it in your build script:

```js
import JHP from './path/to/jhp.js';

const jhp = new JHP(); // <-- This accepts the same options {} as the process method
const html = jhp.process('./template.jhp');
console.log(html);
```

**Note:** Make sure to install JHP's dependencies (`@caboodle-tech/simple-html-parser` and `acorn-loose`) in your project if you use this approach.

### Building JHP into Your Process

Regardless of which installation method you choose, **you must write code to integrate JHP into your build process**. JHP doesn't run automatically &ndash; you need to create a script that:

1. Instantiates the JHP class
2. Calls `jhp.process()` for each template file
3. Writes the output to your desired location

See the [example build script](./examples/index.js) for a complete implementation.

### Using Process Options

The `process` method accepts an options object to customize processing for individual files:

```js
import JHP from '@caboodle-tech/jhp'; // or './path/to/jhp.js' if using manual installation

const jhp = new JHP();

// Process with context variables and custom processors
const html = jhp.process('./template.jhp', {
    context: {
        pageTitle: 'My Page',
        userName: 'John Doe'
    },
    preProcessors: [myPreProcessor],
    postProcessors: [myPostProcessor],
    cwd: './templates',
    relPath: '/blog'
});
```

Available options:
- `context` - Initial variables and functions for template context (Object or Map)
- `preProcessors` - Array of preprocessor functions to apply for this file
- `postProcessors` - Array of postprocessor functions to apply for this file
- `cwd` - Current working directory for file resolution
- `relPath` - Relative path for URL resolution

**Note:** Pre-processors operate on the raw JHP structure (before JHP code is replaced), while post-processors operate on the fully parsed DOM after all JHP code has been replaced with HTML. This means pre-processors can access and modify JHP script blocks, while post-processors work with the final HTML structure.

## Caution

JHP is primarily designed for local development, static site generation, and for use as a view engine. While it can be used as a production server, please proceed with caution due to potential security concerns and lack of extensive testing in high-traffic environments. It is recommended to thoroughly test and review your setup if you choose to use JHP live on a production server.

## Why Choose JHP?

- **Familiar and fast:** Use native HTML, CSS, and JavaScript &ndash; no need for custom templating languages or complex configurations. Just write and build.
- **Lightweight and focused:** With only one development dependency ([acorn](https://www.npmjs.com/package/acorn)), JHP is far simpler than engines requiring multiple plugins or libraries.
- **Flexible structure:** No rigid directory or file structure is enforced &ndash; organize your project in a way that works best for you.
- **Encourages native development:** Fully leverage HTML, CSS, and JavaScript as they are, with support for modern CSS features like nesting. JHP doesn’t require preprocessing tools but allows seamless integration if your project needs them.
- **Modular and maintainable:** Reuse components with file includes and shared templates to keep your code clean and scalable.

JHP streamlines static site generation, empowering developers to build quickly and intuitively without the overhead of traditional templating engines.



