# Demonstration Site

The code in this directory is a demonstration of how I can use JHP to build static multi-page websites. I have added comments to the code to help explain how it works.

## Take Note

In this demonstration, I am using the `.jhp` file extension to indicate files that are entry points to pages or layouts (views). I use `.html` for all the partials (e.g. templates, partials, components) to indicate that they are not entry points but rather consumed by the `.jhp` files. This is an architectural choice and not a requirement of JHP. I originally built JHP for [JamsEDU](https://jamsedu.com), and this simplified how users indicated what was an actual page; if a file ends in `.jhp`, it gets compiled to a `.html` file and output to JamsEDU's build directory.

Currently I am using `<script>` tags in this demo and JHP is configured to treat them as JHP tags. I am doing this so I automatically get proper syntax highlighting and intellisense in my code editor.