(function (window, undefined) {
    'use strict';

    var document = window.document;
    var JSON = window.JSON;

    var customElements = {};

    document.addEventListener('DOMContentLoaded', function () {
        compileElements();
        mountRoots();
    });

    function compileElements() {
        var elements = document.querySelectorAll('tl-element');
        var elementDefs = [];
        for (var i = 0; i < elements.length; i++) {
            elementDefs.push(registerElement(elements[i]));
        }
        for (var i = 0; i < elementDefs.length; i++) {
            compileElement(elementDefs[i]);
        }
    }

    function registerElement(element) {
        var name = element.getAttribute('name'),
            attrsStr = element.getAttribute('attrs'),
            attrs = attrsStr ? attrsStr.split(/\s*,\s*/) : [];

        var funcName = 'tl_element_' + name.replace('-', '_');
        var elementDef = {
            tag: element.getAttribute('tag') || name,
            attrs: attrs,
            funcName: funcName,
            func: null,
            element: element
        };
        customElements[name] = elementDef;
        return elementDef;
    }

    function compileElement(elementDef) {
        // TODO create element with tagName
        var funcName = elementDef.funcName,
            element = elementDef.element,
            attrs = elementDef.attrs,
            params = attrs.length > 0 ? ', ' + attrs.join(', ') : '';

        var funcCode = createTemplateFunc(funcName, params, element) + '\n//# sourceURL=' + funcName;
        var scriptElement = document.createElement('script');
        scriptElement.textContent = funcCode;
        element.parentNode.replaceChild(scriptElement, element);
        elementDef.element = null;

        var func = window[funcName];


        elementDef.func = func;
        func.def = elementDef;
    }

    // TODO create separate create, update, remove functions
    function createTemplateFunc(funcName, params, element) {
        // TODO top
        var funcs = [], varDefs = [], createScript = [], context = [], updateScript = [];
        createScripts(funcName, params, element.firstChild, 'refNode', true, funcs, varDefs, createScript, context, updateScript);
        return funcs.join('\n\n') +
            'function ' + funcName + '(context, refNode, before' + params + ') {\n' +
            varDefs.join('') +
            'if (!context) {\n' +
            createScript.join('\n') +
            'context = [' + context.join(', ') + '];\n' +
            '} else {\n' +
            updateScript.join('\n') +
            '}\n' +
            'return context;\n' +
            '}';
    }

    function mountRoots() {
        var roots = document.querySelectorAll('[tl-root]');
        for (var i = 0; i < roots.length; i++) {
            var root = roots[i];
            mountRoot(root);
        }
    }

    function mountRoot(rootElement) {
        var tag = rootElement.tagName.toLowerCase(),
            customElement = customElements[tag];
        if (customElement) {
            var parentNode = rootElement.parentNode;
            var context = customElement.func(null, parentNode, false);

            var update = function () {
                for (var i = 0; i < dbs.length; i++) {
                    dbs[i].update();
                }

                customElement.func(context);
                //window.requestAnimationFrame(update);
            };
            setInterval(update, 0);
            // update();

            parentNode.removeChild(rootElement);
        }
    }

    var nodeVarCounter = 0,
        valueVarCounter = 0,
        subContextVarCounter = 0,
        funcVarCounter = 0,
        indexVarCounter = 0;

    function createScripts(funcName, params, node, refNodeVar, top, funcs, varDefs, createScript, context, updateScript) {
        var first = true;
        for (; node; node = node.nextSibling) {
            if (top && first) {
                context.push('');
            }
            var nodeVar = 'node' + (nodeVarCounter++),
                nodeType = node.nodeType;

            switch (nodeType) {
                case Node.TEXT_NODE:
                case Node.COMMENT_NODE:
                    var expr = parseExpr(node.data);
                    var func = (nodeType === Node.TEXT_NODE) ? 'createTextNode' : 'createComment';
                    createScript.push('var ' + nodeVar + ' = document.' + func + '(' + expr.expr + ');');
                    if (expr.varDefs) {
                        varDefs.push(expr.varDefs);
                        context.push('[[' + expr.valueVars.join(', ') + '], ' + nodeVar + ']');
                        updateScript.push(simpleUpdateScript(expr.valueVars, context.length - 1, 'data = ' + expr.expr));
                    }
                    break;
                case Node.ELEMENT_NODE:
                    var tagName = node.tagName.toLowerCase();
                    if (tagName.indexOf('ht-') === 0) {
                        tagName = tagName.substr(3);
                    }
                    if (tagName === 'tl-if') {
                        var expr = node.getAttribute('$');
                        var valueVar = 'val' + (valueVarCounter++);
                        varDefs.push('var ' + valueVar + ' = ' + expr + ';\n');

                        var subFuncName = funcName + '_if' + (funcVarCounter++);
                        funcs.push(createTemplateFunc(subFuncName, params, node));

                        var subContextVar = 'subContext' + (subContextVarCounter++);
                        createScript.push('var ' + nodeVar + ' = document.createTextNode("");');
                        createScript.push('var ' + subContextVar + ';');
                        createScript.push('if (' + valueVar + ') {');
                        createScript.push(subContextVar + ' = ' + subFuncName + '(null, ' + refNodeVar + ', before' + params + ');');
                        createScript.push('}');
                        context.push('[' + nodeVar + ', ' + subContextVar + ']');

                        var contextIndex = context.length - 1;
                        updateScript.push('var ' + subContextVar + ' = context[' + contextIndex + '];');
                        updateScript.push('if (' + valueVar + ') {');
                        updateScript.push(subContextVar + '[1] = ' + subFuncName + '(' + subContextVar + '[1], ' + subContextVar + '[0], true' + params + ');');
                        updateScript.push('} else if (' + subContextVar + '[1]) {');
                        updateScript.push('tlRun.remove(' + subContextVar + '[1][0], ' + subContextVar + '[0]);');
                        updateScript.push(subContextVar + '[1] = undefined;');
                        updateScript.push('}');
                    } else if (tagName === 'tl-for') {
                        var expr = node.getAttribute('$');
                        var subContextVar = 'subContext' + (subContextVarCounter++);

                        var ofMatch = expr.match(/(.*) of (.*)/);
                        var forLine;
                        var indexVar, itemVar;
                        if (ofMatch) {
                            indexVar = 'i' + (indexVarCounter++);
                            var valueVar = 'val' + (valueVarCounter++);
                            varDefs.push('var ' + valueVar + ' = ' + ofMatch[2] + ';\n');
                            itemVar = ofMatch[1];
                            forLine = 'for (var ' + indexVar + ' = 0; ' + indexVar + ' < ' + valueVar + '.length; ' + indexVar + '++) { var ' + itemVar + ' = ' + valueVar + '[' + indexVar + '];';
                        } else {
                            var counterMatch = expr.match(/var (.+) = 0;(.*);(.*)/);
                            if (counterMatch) {
                                indexVar = itemVar = counterMatch[1];
                            } else {
                                var inMatch = expr.match(/(.*) in (.*)/);
                                if (inMatch) {
                                    itemVar = inMatch[1];
                                } else {
                                    // TODO uups...
                                }
                            }
                            forLine = 'for (' + expr + ') {';
                        }

                        var subFuncName = funcName + '_for' + (funcVarCounter++);
                        funcs.push(createTemplateFunc(subFuncName, params + ', ' + itemVar, node));

                        createScript.push('var ' + nodeVar + ' = document.createTextNode("");');
                        createScript.push('var ' + subContextVar + ' = [];');
                        createScript.push(forLine);
                        createScript.push(subContextVar + '.push(' + subFuncName + '(null, ' + refNodeVar + ', before' + params + ', ' + itemVar + '));');
                        createScript.push('}');
                        context.push('[' + nodeVar + ', ' + subContextVar + ']');

                        var isNaturalIndex = !!indexVar;

                        var contextIndex = context.length - 1;
                        updateScript.push('var ' + subContextVar + ' = context[' + contextIndex + '];');
                        if (!isNaturalIndex) {
                            indexVar = 'i' + (indexVarCounter++);
                            updateScript.push('var ' + indexVar + ' = 0;');
                        }
                        updateScript.push(forLine);
                        // TODO cache [1] in var
                        updateScript.push(subContextVar + '[1][' + indexVar + '] = ' + subFuncName + '(' + subContextVar + '[1][' + indexVar + '], ' + subContextVar + '[0], true' + params + ', ' + itemVar + ');');
                        if (!isNaturalIndex) {
                            updateScript.push(indexVar + '++;');
                        }
                        updateScript.push('}');
                        updateScript.push('if (' + subContextVar + '[1].length > ' + indexVar + ' + 1) {');
                        updateScript.push('tlRun.remove(' + subContextVar + '[1][' + indexVar + ' + 1][0], ' + subContextVar + '[0])');
                        updateScript.push(subContextVar + '[1].length = ' + indexVar + ' + 1;');
                        updateScript.push('}');
                    } else {
                        var customElement = customElements[tagName];
                        tagName = customElement ? customElement.tag : tagName;
                        createScript.push('var ' + nodeVar + ' = document.createElement("' + tagName + '");');

                        var elementAttrs = customElement && customElement.attrs;

                        // TODO boolean attributes
                        // TODO optimize style attribute
                        // TODO store attribute?
                        var attrs = node.attributes;
                        for (var i = 0; i < attrs.length; i++) {
                            var attr = attrs[i],
                                attrName = attr.name;
                            if (elementAttrs && elementAttrs.indexOf(attrName) !== -1) {
                                continue;
                            }
                            var expr = parseExpr(attr.value);
                            if (attrName === 'class') {
                                createScript.push(nodeVar + '.className = ' + expr.expr + ';');
                            } else {
                                createScript.push(nodeVar + '.setAttribute("' + attrName + '", ' + expr.expr + ');');
                            }
                            if (expr.varDefs) {
                                varDefs.push(expr.varDefs);
                                context.push('[[' + expr.valueVars.join(', ') + '], ' + nodeVar + ']');
                                var updateExpr = (attrName === 'class') ? 'className = ' + expr.expr : 'setAttribute("' + attrName + '", ' + expr.expr + ')';
                                updateScript.push(simpleUpdateScript(expr.valueVars, context.length - 1, updateExpr));
                            }
                        }

                        if (customElement) {
                            var funcArgs = '';
                            for (var i = 0; i < elementAttrs.length; i++) {
                                funcArgs += ', ';
                                var attrName = elementAttrs[i],
                                    attrValue = node.getAttribute(attrName) || '',
                                    expr = parseExpr(attrValue);
                                // TODO handle missing
                                varDefs.push(expr.varDefs);
                                funcArgs += expr.expr;
                            }
                            var subContextVar = 'subContext' + (subContextVarCounter++),
                                funcName = customElement.funcName;
                            createScript.push('var ' + subContextVar + ' = ' + funcName + '(null, ' + nodeVar + ', before' + funcArgs + ');');
                            context.push(subContextVar);
                            // TODO heh?
                            updateScript.push(funcName + '(context[' + (context.length - 1) + ']' + ', ' + nodeVar + ', true' +  funcArgs + ');');
                        } else {
                            createScripts(funcName, params, node.firstChild, nodeVar, false, funcs, varDefs, createScript, context, updateScript);
                        }
                    }
                    break;
                default:
                    console.warn('Unsupported node type:', node);
                    continue;
            }
            if (top) {
                if (first) {
                    context[0] = nodeVar;
                }
                createScript.push('if (before) { refNode.parentNode.insertBefore(' + nodeVar + ', refNode); }');
                createScript.push('else {' + refNodeVar + '.appendChild(' + nodeVar + '); }');
            } else {
                createScript.push(refNodeVar + '.appendChild(' + nodeVar + ');');
            }
            first = false;
        }
    }

    function simpleUpdateScript(valueVars, contextIndex, updateExpr) {
        var contextVar = 'context' + contextIndex;
        var script = 'var ' + contextVar + ' = context[' + contextIndex + '];\n';
        var notEqualExpr = '';
        for (var j = 0; j < valueVars.length; j++) {
            if (j > 0) {
                notEqualExpr += ' || ';
            }
            var valueVar = valueVars[j];
            notEqualExpr += contextVar + '[0][' + j + '] !== ' + valueVar;
        }
        script += 'if (' + notEqualExpr + ') {\n';
        script += contextVar + '[1].' + updateExpr + ';\n';
        for (var j = 0; j < valueVars.length; j++) {
            var valueVar = valueVars[j];
            script += contextVar + '[0][' + j + '] = ' + valueVar + ';\n';
        }
        script += '}';
        return script;
    }

    function parseExpr(str) {
        var regex = /\$\{(.*?)}/g,
            expr = '', match, lastIndex = 0,
            valueVars = [], varDefs = '';
        while (match = regex.exec(str)) {
            var valueVar = 'val' + (valueVarCounter++);
            valueVars.push(valueVar);
            varDefs += 'var ' + valueVar + ' = ' + match[1] + ';\n';
            var subStr = str.substring(lastIndex, match.index);
            if (subStr.length > 0) {
                expr += escapeStr(subStr);
            }
            if (expr.length > 0) {
                expr += ' + ';
            }
            expr += valueVar;
            lastIndex = regex.lastIndex;
        }
        var subStr = str.substring(lastIndex);
        if (subStr.length > 0) {
            if (expr.length > 0) {
                expr += ' + ';
            }
            expr += escapeStr(subStr);
        }
        return {expr: expr, valueVars: valueVars, varDefs: varDefs};
    }

    function escapeStr(str) {
        return JSON.stringify('' + str);
    }

    var tlRun = window.tlRun = {
        remove: function (startNodeInclusive, endNodeExclusive) {
            var parentNode = startNodeInclusive.parentNode;
            while (startNodeInclusive !== endNodeExclusive) {
                var nextNode = startNodeInclusive.nextSibling;
                parentNode.removeChild(startNodeInclusive);
                startNodeInclusive = nextNode;
            }
        }
    };

})(window);