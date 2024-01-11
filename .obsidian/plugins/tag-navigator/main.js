'use strict';

var obsidian = require('obsidian');

const VIEW_TYPE = "tag-navigator";

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function null_to_empty(value) {
    return value == null ? '' : value;
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function svg_element(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
function set_style(node, key, value, important) {
    node.style.setProperty(key, value, important ? 'important' : '');
}
// unfortunately this can't be a constant as that wouldn't be tree-shakeable
// so we cache the result instead
let crossorigin;
function is_crossorigin() {
    if (crossorigin === undefined) {
        crossorigin = false;
        try {
            if (typeof window !== 'undefined' && window.parent) {
                void window.parent.document;
            }
        }
        catch (error) {
            crossorigin = true;
        }
    }
    return crossorigin;
}
function add_resize_listener(node, fn) {
    const computed_style = getComputedStyle(node);
    if (computed_style.position === 'static') {
        node.style.position = 'relative';
    }
    const iframe = element('iframe');
    iframe.setAttribute('style', 'display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; ' +
        'overflow: hidden; border: 0; opacity: 0; pointer-events: none; z-index: -1;');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    const crossorigin = is_crossorigin();
    let unsubscribe;
    if (crossorigin) {
        iframe.src = "data:text/html,<script>onresize=function(){parent.postMessage(0,'*')}</script>";
        unsubscribe = listen(window, 'message', (event) => {
            if (event.source === iframe.contentWindow)
                fn();
        });
    }
    else {
        iframe.src = 'about:blank';
        iframe.onload = () => {
            unsubscribe = listen(iframe.contentWindow, 'resize', fn);
        };
    }
    append(node, iframe);
    return () => {
        if (crossorigin) {
            unsubscribe();
        }
        else if (unsubscribe && iframe.contentWindow) {
            unsubscribe();
        }
        detach(iframe);
    };
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}
function create_component(block) {
    block && block.c();
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

function tagParts(tag) {
    let temp = tag.slice();
    if (tag.startsWith("#")) {
        temp = temp.slice(1);
    }
    if (temp.contains('/')) {
        const split = temp.split('/');
        const label = split.shift();
        const title = split.join('/');
        return {
            tag: tag,
            label: label,
            title: title
        };
    }
    else {
        return {
            tag: tag,
            title: temp
        };
    }
}

/* src/ui/TagTitle.svelte generated by Svelte v3.35.0 */

function add_css$1() {
	var style = element("style");
	style.id = "svelte-thzrmn-style";
	style.textContent = "p.svelte-thzrmn{margin:0}.strong.svelte-thzrmn{font-weight:bold}.small.svelte-thzrmn{font-size:12px;line-height:14px}.muted.svelte-thzrmn{opacity:0.5}";
	append(document.head, style);
}

// (20:0) {:else}
function create_else_block$1(ctx) {
	let p;
	let span;
	let t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "";
	let t0;
	let t1;
	let p_class_value;

	return {
		c() {
			p = element("p");
			span = element("span");
			t0 = text(t0_value);
			t1 = text(/*title*/ ctx[3]);
			attr(span, "class", "muted svelte-thzrmn");
			attr(p, "class", p_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"));
		},
		m(target, anchor) {
			insert(target, p, anchor);
			append(p, span);
			append(span, t0);
			append(p, t1);
		},
		p(ctx, dirty) {
			if (dirty & /*label*/ 4 && t0_value !== (t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "")) set_data(t0, t0_value);
			if (dirty & /*title*/ 8) set_data(t1, /*title*/ ctx[3]);

			if (dirty & /*strong*/ 2 && p_class_value !== (p_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"))) {
				attr(p, "class", p_class_value);
			}
		},
		d(detaching) {
			if (detaching) detach(p);
		}
	};
}

// (15:0) {#if !inline}
function create_if_block$1(ctx) {
	let div;
	let p0;
	let t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "";
	let t0;
	let t1;
	let p1;
	let t2;
	let div_class_value;

	return {
		c() {
			div = element("div");
			p0 = element("p");
			t0 = text(t0_value);
			t1 = space();
			p1 = element("p");
			t2 = text(/*title*/ ctx[3]);
			attr(p0, "class", "small muted svelte-thzrmn");
			attr(p1, "class", "svelte-thzrmn");
			attr(div, "class", div_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"));
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, p0);
			append(p0, t0);
			append(div, t1);
			append(div, p1);
			append(p1, t2);
		},
		p(ctx, dirty) {
			if (dirty & /*label*/ 4 && t0_value !== (t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "")) set_data(t0, t0_value);
			if (dirty & /*title*/ 8) set_data(t2, /*title*/ ctx[3]);

			if (dirty & /*strong*/ 2 && div_class_value !== (div_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"))) {
				attr(div, "class", div_class_value);
			}
		},
		d(detaching) {
			if (detaching) detach(div);
		}
	};
}

function create_fragment$2(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (!/*inline*/ ctx[0]) return create_if_block$1;
		return create_else_block$1;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, [dirty]) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { tag } = $$props;
	let { inline = false } = $$props;
	let { strong = false } = $$props;
	let label;
	let title;

	function recalc(tag) {
		let parts = tagParts(tag);
		$$invalidate(2, label = parts.label);
		$$invalidate(3, title = parts.title);
	}

	$$self.$$set = $$props => {
		if ("tag" in $$props) $$invalidate(4, tag = $$props.tag);
		if ("inline" in $$props) $$invalidate(0, inline = $$props.inline);
		if ("strong" in $$props) $$invalidate(1, strong = $$props.strong);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*tag*/ 16) {
			recalc(tag);
		}
	};

	return [inline, strong, label, title, tag];
}

class TagTitle extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-thzrmn-style")) add_css$1();
		init(this, options, instance$2, create_fragment$2, safe_not_equal, { tag: 4, inline: 0, strong: 1 });
	}
}

/* src/ui/Star.svelte generated by Svelte v3.35.0 */

function create_fragment$1(ctx) {
	let svg;
	let g1;
	let g0;
	let path;
	let g0_style_value;

	return {
		c() {
			svg = svg_element("svg");
			g1 = svg_element("g");
			g0 = svg_element("g");
			path = svg_element("path");
			attr(path, "d", "M48.8394265,42.7860368 C49.3198892,42.8598485 49.3997029,42.9396623 49.448368,43.0382686 L49.448368,43.0382686 L50.6701024,45.5137728 C50.8885954,45.956488 51.3109438,46.2633421 51.799509,46.3343348 L51.799509,46.3343348 L54.5313901,46.7313003 C54.6680264,46.7511547 54.7836797,46.8245123 54.8602103,46.9270653 C54.9367409,47.0296183 54.9741489,47.1613668 54.9542945,47.298003 C54.9384822,47.4068215 54.8872387,47.5073927 54.8084968,47.584147 L54.8084968,47.584147 L52.8316891,49.5110583 C52.47816,49.8556641 52.3168372,50.3521644 52.4002942,50.8387555 L52.4002942,50.8387555 L52.8669552,53.5595979 C52.8902954,53.695682 52.8562671,53.8283436 52.7823826,53.9328191 C52.7084982,54.0372947 52.5947576,54.1135843 52.4586735,54.1369246 C52.3502947,54.155513 52.2388107,54.1378557 52.1414804,54.0866861 L52.1414804,54.0866861 L49.6980117,52.8020786 C49.2610257,52.5723414 48.7389743,52.5723414 48.3019883,52.8020786 L48.3019883,52.8020786 L45.8585196,54.0866861 C45.7363084,54.1509363 45.5996245,54.1595681 45.4774307,54.1215846 C45.355237,54.083601 45.2475335,53.9990021 45.1832833,53.876791 C45.1321138,53.7794607 45.1144564,53.6679767 45.1330448,53.5595979 L45.1330448,53.5595979 L45.5997058,50.8387555 C45.6831628,50.3521644 45.52184,49.8556641 45.1683109,49.5110583 L45.1683109,49.5110583 L43.1915032,47.584147 C43.0926323,47.4877717 43.0421853,47.3604449 43.0405498,47.2324942 C43.0389144,47.1045435 43.0860905,46.9759689 43.1824658,46.877098 C43.2592201,46.7983562 43.3597913,46.7471126 43.4686099,46.7313003 L43.4686099,46.7313003 L46.200491,46.3343348 C46.6890562,46.2633421 47.1114046,45.956488 47.3298976,45.5137728 L47.3298976,45.5137728 L48.551632,43.0382686 C48.6127375,42.9144552 48.7182436,42.8271311 48.8394265,42.7860368 Z");
			attr(path, "id", "Star");
			attr(g0, "id", "Artboard");
			attr(g0, "transform", "translate(-42.000000, -42.000000)");

			attr(g0, "style", g0_style_value = /*filled*/ ctx[0]
			? "fill: var(--text-on-accent);"
			: "stroke: var(--text-on-accent);");

			attr(g1, "id", "Page-1");
			attr(g1, "stroke", "none");
			attr(g1, "stroke-width", "1");
			attr(g1, "fill", "none");
			attr(g1, "fill-rule", "evenodd");
			attr(svg, "width", "14px");
			attr(svg, "height", "13px");
			attr(svg, "viewBox", "0 0 14 13");
			attr(svg, "version", "1.1");
			attr(svg, "xmlns", "http://www.w3.org/2000/svg");
			attr(svg, "xmlns:xlink", "http://www.w3.org/1999/xlink");
		},
		m(target, anchor) {
			insert(target, svg, anchor);
			append(svg, g1);
			append(g1, g0);
			append(g0, path);
		},
		p(ctx, [dirty]) {
			if (dirty & /*filled*/ 1 && g0_style_value !== (g0_style_value = /*filled*/ ctx[0]
			? "fill: var(--text-on-accent);"
			: "stroke: var(--text-on-accent);")) {
				attr(g0, "style", g0_style_value);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(svg);
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { filled } = $$props;

	$$self.$$set = $$props => {
		if ("filled" in $$props) $$invalidate(0, filled = $$props.filled);
	};

	return [filled];
}

class Star extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, { filled: 0 });
	}
}

/* src/ui/TagMenu.svelte generated by Svelte v3.35.0 */

function add_css() {
	var style = element("style");
	style.id = "svelte-1srsbn2-style";
	style.textContent = "p.svelte-1srsbn2.svelte-1srsbn2{margin:0}.path.svelte-1srsbn2.svelte-1srsbn2{display:flex;align-items:flex-end}.path.svelte-1srsbn2>.svelte-1srsbn2{margin:0 5px}.muted.svelte-1srsbn2.svelte-1srsbn2{opacity:0.5}.strong.svelte-1srsbn2.svelte-1srsbn2{font-weight:bold}.small.svelte-1srsbn2.svelte-1srsbn2{font-size:12px}.label.svelte-1srsbn2.svelte-1srsbn2{white-space:nowrap;margin-right:4px}.flex.svelte-1srsbn2.svelte-1srsbn2{display:flex;justify-content:flex-start}.align-bottom.svelte-1srsbn2.svelte-1srsbn2{align-items:flex-end}.align-center.svelte-1srsbn2.svelte-1srsbn2{align-items:center}.flex-wrap.svelte-1srsbn2.svelte-1srsbn2{flex-wrap:wrap}.spacer.svelte-1srsbn2.svelte-1srsbn2{width:10px;height:10px}.flex-spacer.svelte-1srsbn2.svelte-1srsbn2{flex-grow:1;flex-shrink:0;width:5px}.hscroll.svelte-1srsbn2.svelte-1srsbn2{max-width:100%;overflow:auto}.mutedLink.svelte-1srsbn2.svelte-1srsbn2{cursor:pointer;opacity:0.5;transition:all 0.2 ease}.mutedLink.svelte-1srsbn2.svelte-1srsbn2:hover{opacity:1}.link.svelte-1srsbn2.svelte-1srsbn2{cursor:pointer;background:transparent;border-radius:3px;transition:all 0.25s ease;font-size:14px}.link.svelte-1srsbn2.svelte-1srsbn2:hover{background:var(--interactive-accent);color:var(--text-on-accent);padding-left:4px}.small.svelte-1srsbn2.svelte-1srsbn2{font-size:13px}ul.svelte-1srsbn2.svelte-1srsbn2{list-style:none;padding-left:0;margin:0}li.intersection.svelte-1srsbn2.svelte-1srsbn2:before{content:\"+\";margin-right:4px;opacity:0.5}li.note.svelte-1srsbn2.svelte-1srsbn2:before{content:\"→\";margin-right:4px}.cutoff.svelte-1srsbn2.svelte-1srsbn2{max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.btn.svelte-1srsbn2.svelte-1srsbn2{cursor:pointer;padding:4px 10px;border-radius:100px;border:1px solid var(--interactive-accent);font-weight:bold;font-size:12px;margin-right:10px;transition:all 0.2s ease}.btn.muted.svelte-1srsbn2.svelte-1srsbn2{border:1px solid var(--text-on-accent);opacity:0.25}.btn.svelte-1srsbn2.svelte-1srsbn2:hover{background:var(--interactive-accent);color:var(--text-on-accent)}.star.svelte-1srsbn2.svelte-1srsbn2{width:14px;height:14px;margin-left:5px}.star.slideout.svelte-1srsbn2.svelte-1srsbn2{position:relative;left:-19px;margin-right:-19px;opacity:0;pointer-events:none;transition:all 0.2s ease}.btn.svelte-1srsbn2:hover .star.slideout.svelte-1srsbn2{opacity:1;pointer-events:all;left:0px;margin-right:0}";
	append(document.head, style);
}

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[23] = list[i];
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[26] = list[i];
	return child_ctx;
}

function get_each_context_2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[29] = list[i];
	return child_ctx;
}

function get_each_context_3(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[23] = list[i];
	return child_ctx;
}

function get_each_context_4(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[34] = list[i];
	return child_ctx;
}

function get_each_context_5(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[26] = list[i];
	return child_ctx;
}

function get_each_context_6(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[26] = list[i];
	return child_ctx;
}

function get_each_context_7(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[29] = list[i];
	child_ctx[42] = i;
	return child_ctx;
}

// (45:6) {#each $viewStore.selectedTags as tag, index}
function create_each_block_7(ctx) {
	let div0;
	let t1;
	let div1;
	let tagtitle;
	let current;
	let mounted;
	let dispose;
	tagtitle = new TagTitle({ props: { tag: /*tag*/ ctx[29] } });

	function click_handler_1(...args) {
		return /*click_handler_1*/ ctx[9](/*tag*/ ctx[29], /*index*/ ctx[42], ...args);
	}

	return {
		c() {
			div0 = element("div");
			div0.textContent = "›";
			t1 = space();
			div1 = element("div");
			create_component(tagtitle.$$.fragment);
			attr(div0, "class", "svelte-1srsbn2");
			attr(div1, "class", "link svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, div0, anchor);
			insert(target, t1, anchor);
			insert(target, div1, anchor);
			mount_component(tagtitle, div1, null);
			current = true;

			if (!mounted) {
				dispose = listen(div1, "click", click_handler_1);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*$viewStore*/ 32) tagtitle_changes.tag = /*tag*/ ctx[29];
			tagtitle.$set(tagtitle_changes);
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div0);
			if (detaching) detach(t1);
			if (detaching) detach(div1);
			destroy_component(tagtitle);
			mounted = false;
			dispose();
		}
	};
}

// (62:8) {#each $viewStore.allGroups as label}
function create_each_block_6(ctx) {
	let div1;
	let t0_value = /*label*/ ctx[26] + "";
	let t0;
	let t1;
	let div0;
	let star;
	let div0_class_value;
	let t2;
	let div1_class_value;
	let current;
	let mounted;
	let dispose;

	star = new Star({
			props: {
				filled: /*$settingsStore*/ ctx[6].favoriteGroups.includes(/*label*/ ctx[26])
			}
		});

	function click_handler_2(...args) {
		return /*click_handler_2*/ ctx[10](/*label*/ ctx[26], ...args);
	}

	function click_handler_3(...args) {
		return /*click_handler_3*/ ctx[11](/*label*/ ctx[26], ...args);
	}

	return {
		c() {
			div1 = element("div");
			t0 = text(t0_value);
			t1 = space();
			div0 = element("div");
			create_component(star.$$.fragment);
			t2 = space();

			attr(div0, "class", div0_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].favoriteGroups.includes(/*label*/ ctx[26])
			? "star"
			: "star slideout") + " svelte-1srsbn2"));

			set_style(div1, "display", "flex");
			set_style(div1, "align-items", "center");

			attr(div1, "class", div1_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].excludedGroups.includes(/*label*/ ctx[26])
			? "btn muted"
			: "btn") + " svelte-1srsbn2"));
		},
		m(target, anchor) {
			insert(target, div1, anchor);
			append(div1, t0);
			append(div1, t1);
			append(div1, div0);
			mount_component(star, div0, null);
			append(div1, t2);
			current = true;

			if (!mounted) {
				dispose = [
					listen(div0, "click", click_handler_2),
					listen(div1, "click", click_handler_3)
				];

				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if ((!current || dirty[0] & /*$viewStore*/ 32) && t0_value !== (t0_value = /*label*/ ctx[26] + "")) set_data(t0, t0_value);
			const star_changes = {};
			if (dirty[0] & /*$settingsStore, $viewStore*/ 96) star_changes.filled = /*$settingsStore*/ ctx[6].favoriteGroups.includes(/*label*/ ctx[26]);
			star.$set(star_changes);

			if (!current || dirty[0] & /*$settingsStore, $viewStore*/ 96 && div0_class_value !== (div0_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].favoriteGroups.includes(/*label*/ ctx[26])
			? "star"
			: "star slideout") + " svelte-1srsbn2"))) {
				attr(div0, "class", div0_class_value);
			}

			if (!current || dirty[0] & /*$settingsStore, $viewStore*/ 96 && div1_class_value !== (div1_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].excludedGroups.includes(/*label*/ ctx[26])
			? "btn muted"
			: "btn") + " svelte-1srsbn2"))) {
				attr(div1, "class", div1_class_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(star.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(star.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_component(star);
			mounted = false;
			run_all(dispose);
		}
	};
}

// (76:8) {#each $viewStore.allTags as label}
function create_each_block_5(ctx) {
	let div1;
	let t0_value = /*label*/ ctx[26] + "";
	let t0;
	let t1;
	let div0;
	let star;
	let div0_class_value;
	let t2;
	let div1_class_value;
	let current;
	let mounted;
	let dispose;

	star = new Star({
			props: {
				filled: /*$settingsStore*/ ctx[6].favoriteTags.includes(/*label*/ ctx[26])
			}
		});

	function click_handler_4(...args) {
		return /*click_handler_4*/ ctx[12](/*label*/ ctx[26], ...args);
	}

	function click_handler_5(...args) {
		return /*click_handler_5*/ ctx[13](/*label*/ ctx[26], ...args);
	}

	return {
		c() {
			div1 = element("div");
			t0 = text(t0_value);
			t1 = space();
			div0 = element("div");
			create_component(star.$$.fragment);
			t2 = space();

			attr(div0, "class", div0_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].favoriteTags.includes(/*label*/ ctx[26])
			? "star"
			: "star slideout") + " svelte-1srsbn2"));

			set_style(div1, "display", "flex");
			set_style(div1, "align-items", "center");

			attr(div1, "class", div1_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].excludedTags.includes(/*label*/ ctx[26])
			? "btn muted"
			: "btn") + " svelte-1srsbn2"));
		},
		m(target, anchor) {
			insert(target, div1, anchor);
			append(div1, t0);
			append(div1, t1);
			append(div1, div0);
			mount_component(star, div0, null);
			append(div1, t2);
			current = true;

			if (!mounted) {
				dispose = [
					listen(div0, "click", click_handler_4),
					listen(div1, "click", click_handler_5)
				];

				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if ((!current || dirty[0] & /*$viewStore*/ 32) && t0_value !== (t0_value = /*label*/ ctx[26] + "")) set_data(t0, t0_value);
			const star_changes = {};
			if (dirty[0] & /*$settingsStore, $viewStore*/ 96) star_changes.filled = /*$settingsStore*/ ctx[6].favoriteTags.includes(/*label*/ ctx[26]);
			star.$set(star_changes);

			if (!current || dirty[0] & /*$settingsStore, $viewStore*/ 96 && div0_class_value !== (div0_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].favoriteTags.includes(/*label*/ ctx[26])
			? "star"
			: "star slideout") + " svelte-1srsbn2"))) {
				attr(div0, "class", div0_class_value);
			}

			if (!current || dirty[0] & /*$settingsStore, $viewStore*/ 96 && div1_class_value !== (div1_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[6].excludedTags.includes(/*label*/ ctx[26])
			? "btn muted"
			: "btn") + " svelte-1srsbn2"))) {
				attr(div1, "class", div1_class_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(star.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(star.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div1);
			destroy_component(star);
			mounted = false;
			run_all(dispose);
		}
	};
}

// (89:4) {#if $viewStore.allMatchingFiles.length > 3}
function create_if_block_1(ctx) {
	let each_1_anchor;
	let current;
	let each_value_1 = /*$viewStore*/ ctx[5].groupsSorted;
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			each_1_anchor = empty();
		},
		m(target, anchor) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(target, anchor);
			}

			insert(target, each_1_anchor, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*viewStore, $viewStore, columns, openFile*/ 170) {
				each_value_1 = /*$viewStore*/ ctx[5].groupsSorted;
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			destroy_each(each_blocks, detaching);
			if (detaching) detach(each_1_anchor);
		}
	};
}

// (100:14) {#if $viewStore.toShow[label][tag].files.length > 5}
function create_if_block_4(ctx) {
	let ul;
	let t;
	let div;
	let current;
	let each_value_4 = /*$viewStore*/ ctx[5].crossrefsSorted[/*label*/ ctx[26]][/*tag*/ ctx[29]].slice(0, 5);
	let each_blocks = [];

	for (let i = 0; i < each_value_4.length; i += 1) {
		each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			div = element("div");
			attr(ul, "class", "svelte-1srsbn2");
			attr(div, "class", "spacer svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, ul, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}

			insert(target, t, anchor);
			insert(target, div, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*viewStore, $viewStore, columns*/ 42) {
				each_value_4 = /*$viewStore*/ ctx[5].crossrefsSorted[/*label*/ ctx[26]][/*tag*/ ctx[29]].slice(0, 5);
				let i;

				for (i = 0; i < each_value_4.length; i += 1) {
					const child_ctx = get_each_context_4(ctx, each_value_4, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_4(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul, null);
					}
				}

				group_outros();

				for (i = each_value_4.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_4.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(ul);
			destroy_each(each_blocks, detaching);
			if (detaching) detach(t);
			if (detaching) detach(div);
		}
	};
}

// (102:18) {#each $viewStore.crossrefsSorted[label][tag].slice(0, 5) as tag2}
function create_each_block_4(ctx) {
	let li;
	let div0;
	let tagtitle;
	let t0;
	let div1;
	let t1;
	let span;
	let t2_value = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].crossrefs[/*tag2*/ ctx[34]] + "";
	let t2;
	let t3;
	let current;
	let mounted;
	let dispose;

	tagtitle = new TagTitle({
			props: { tag: /*tag2*/ ctx[34], inline: true }
		});

	function click_handler_7(...args) {
		return /*click_handler_7*/ ctx[15](/*tag*/ ctx[29], /*tag2*/ ctx[34], ...args);
	}

	return {
		c() {
			li = element("li");
			div0 = element("div");
			create_component(tagtitle.$$.fragment);
			t0 = space();
			div1 = element("div");
			t1 = space();
			span = element("span");
			t2 = text(t2_value);
			t3 = space();
			attr(div0, "class", "flex small svelte-1srsbn2");
			attr(div1, "class", "flex-spacer svelte-1srsbn2");
			attr(span, "class", "muted svelte-1srsbn2");
			attr(li, "class", "intersection flex link svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, div0);
			mount_component(tagtitle, div0, null);
			append(li, t0);
			append(li, div1);
			append(li, t1);
			append(li, span);
			append(span, t2);
			append(li, t3);
			current = true;

			if (!mounted) {
				dispose = listen(li, "click", click_handler_7);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*$viewStore, columns*/ 40) tagtitle_changes.tag = /*tag2*/ ctx[34];
			tagtitle.$set(tagtitle_changes);
			if ((!current || dirty[0] & /*$viewStore, columns*/ 40) && t2_value !== (t2_value = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].crossrefs[/*tag2*/ ctx[34]] + "")) set_data(t2, t2_value);
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(tagtitle);
			mounted = false;
			dispose();
		}
	};
}

// (115:16) {#each $viewStore.toShow[label][tag].files.slice(0, 5) as file}
function create_each_block_3(ctx) {
	let li;
	let t_value = /*file*/ ctx[23].basename + "";
	let t;
	let mounted;
	let dispose;

	function click_handler_8(...args) {
		return /*click_handler_8*/ ctx[16](/*file*/ ctx[23], ...args);
	}

	return {
		c() {
			li = element("li");
			t = text(t_value);
			attr(li, "class", "small note cutoff link svelte-1srsbn2");
			attr(li, "style", "max-width:" + columnWidth + "px");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, t);

			if (!mounted) {
				dispose = listen(li, "click", click_handler_8);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*$viewStore, columns*/ 40 && t_value !== (t_value = /*file*/ ctx[23].basename + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(li);
			mounted = false;
			dispose();
		}
	};
}

// (92:10) {#each $viewStore.tagsSorted[label].slice(0, $viewStore.expandedGroups.includes(label) ? $viewStore.tagsSorted[label].length : columns) as tag}
function create_each_block_2(ctx) {
	let div2;
	let div1;
	let tagtitle;
	let t0;
	let div0;
	let t1;
	let span;
	let t2_value = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.length + "";
	let t2;
	let t3;
	let t4;
	let ul;
	let t5;
	let current;
	let mounted;
	let dispose;

	tagtitle = new TagTitle({
			props: {
				tag: /*tag*/ ctx[29],
				inline: false,
				strong: true
			}
		});

	function click_handler_6(...args) {
		return /*click_handler_6*/ ctx[14](/*tag*/ ctx[29], ...args);
	}

	let if_block = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.length > 5 && create_if_block_4(ctx);
	let each_value_3 = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.slice(0, 5);
	let each_blocks = [];

	for (let i = 0; i < each_value_3.length; i += 1) {
		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
	}

	return {
		c() {
			div2 = element("div");
			div1 = element("div");
			create_component(tagtitle.$$.fragment);
			t0 = space();
			div0 = element("div");
			t1 = space();
			span = element("span");
			t2 = text(t2_value);
			t3 = space();
			if (if_block) if_block.c();
			t4 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t5 = space();
			attr(div0, "class", "flex-spacer svelte-1srsbn2");
			attr(span, "class", "muted strong svelte-1srsbn2");
			attr(div1, "class", "flex align-bottom link svelte-1srsbn2");
			attr(ul, "class", "svelte-1srsbn2");
			attr(div2, "style", "margin: " + columnMargin + "px; width: " + columnWidth + "px;");
		},
		m(target, anchor) {
			insert(target, div2, anchor);
			append(div2, div1);
			mount_component(tagtitle, div1, null);
			append(div1, t0);
			append(div1, div0);
			append(div1, t1);
			append(div1, span);
			append(span, t2);
			append(div2, t3);
			if (if_block) if_block.m(div2, null);
			append(div2, t4);
			append(div2, ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}

			append(div2, t5);
			current = true;

			if (!mounted) {
				dispose = listen(div1, "click", click_handler_6);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*$viewStore, columns*/ 40) tagtitle_changes.tag = /*tag*/ ctx[29];
			tagtitle.$set(tagtitle_changes);
			if ((!current || dirty[0] & /*$viewStore, columns*/ 40) && t2_value !== (t2_value = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.length + "")) set_data(t2, t2_value);

			if (/*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.length > 5) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty[0] & /*$viewStore, columns*/ 40) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block_4(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div2, t4);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}

			if (dirty[0] & /*openFile, $viewStore, columns*/ 168) {
				each_value_3 = /*$viewStore*/ ctx[5].toShow[/*label*/ ctx[26]][/*tag*/ ctx[29]].files.slice(0, 5);
				let i;

				for (i = 0; i < each_value_3.length; i += 1) {
					const child_ctx = get_each_context_3(ctx, each_value_3, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_3(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(ul, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_3.length;
			}
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);
			destroy_component(tagtitle);
			if (if_block) if_block.d();
			destroy_each(each_blocks, detaching);
			mounted = false;
			dispose();
		}
	};
}

// (122:8) {#if $viewStore.tagsSorted[label].length > columns && label.length > 0}
function create_if_block_2(ctx) {
	let show_if;
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (show_if == null || dirty[0] & /*$viewStore*/ 32) show_if = !!!/*$viewStore*/ ctx[5].expandedGroups.includes(/*label*/ ctx[26]);
		if (show_if) return create_if_block_3;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx, [-1]);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx, dirty)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (125:10) {:else}
function create_else_block(ctx) {
	let div;
	let t0;
	let t1_value = /*label*/ ctx[26] + "";
	let t1;
	let mounted;
	let dispose;

	function click_handler_10(...args) {
		return /*click_handler_10*/ ctx[18](/*label*/ ctx[26], ...args);
	}

	return {
		c() {
			div = element("div");
			t0 = text("Show less in ");
			t1 = text(t1_value);
			attr(div, "class", "small mutedLink svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t0);
			append(div, t1);

			if (!mounted) {
				dispose = listen(div, "click", click_handler_10);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*$viewStore*/ 32 && t1_value !== (t1_value = /*label*/ ctx[26] + "")) set_data(t1, t1_value);
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

// (123:10) {#if !$viewStore.expandedGroups.includes(label)}
function create_if_block_3(ctx) {
	let div;
	let t0;
	let t1_value = /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length - /*columns*/ ctx[3] + "";
	let t1;
	let t2;
	let t3_value = /*label*/ ctx[26] + "";
	let t3;
	let mounted;
	let dispose;

	function click_handler_9(...args) {
		return /*click_handler_9*/ ctx[17](/*label*/ ctx[26], ...args);
	}

	return {
		c() {
			div = element("div");
			t0 = text("Show ");
			t1 = text(t1_value);
			t2 = text(" more in ");
			t3 = text(t3_value);
			attr(div, "class", "small mutedLink svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t0);
			append(div, t1);
			append(div, t2);
			append(div, t3);

			if (!mounted) {
				dispose = listen(div, "click", click_handler_9);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*$viewStore, columns*/ 40 && t1_value !== (t1_value = /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length - /*columns*/ ctx[3] + "")) set_data(t1, t1_value);
			if (dirty[0] & /*$viewStore*/ 32 && t3_value !== (t3_value = /*label*/ ctx[26] + "")) set_data(t3, t3_value);
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

// (90:6) {#each $viewStore.groupsSorted as label}
function create_each_block_1(ctx) {
	let div;
	let t0;
	let t1;
	let hr;
	let current;

	let each_value_2 = /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].slice(0, /*$viewStore*/ ctx[5].expandedGroups.includes(/*label*/ ctx[26])
	? /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length
	: /*columns*/ ctx[3]);

	let each_blocks = [];

	for (let i = 0; i < each_value_2.length; i += 1) {
		each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	let if_block = /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length > /*columns*/ ctx[3] && /*label*/ ctx[26].length > 0 && create_if_block_2(ctx);

	return {
		c() {
			div = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t0 = space();
			if (if_block) if_block.c();
			t1 = space();
			hr = element("hr");
			attr(div, "class", "flex flex-wrap svelte-1srsbn2");
			attr(div, "style", "margin: 0 -" + columnMargin + "px;");
		},
		m(target, anchor) {
			insert(target, div, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div, null);
			}

			insert(target, t0, anchor);
			if (if_block) if_block.m(target, anchor);
			insert(target, t1, anchor);
			insert(target, hr, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*$viewStore, columns, openFile, viewStore*/ 170) {
				each_value_2 = /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].slice(0, /*$viewStore*/ ctx[5].expandedGroups.includes(/*label*/ ctx[26])
				? /*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length
				: /*columns*/ ctx[3]);

				let i;

				for (i = 0; i < each_value_2.length; i += 1) {
					const child_ctx = get_each_context_2(ctx, each_value_2, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_2(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div, null);
					}
				}

				group_outros();

				for (i = each_value_2.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (/*$viewStore*/ ctx[5].tagsSorted[/*label*/ ctx[26]].length > /*columns*/ ctx[3] && /*label*/ ctx[26].length > 0) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block_2(ctx);
					if_block.c();
					if_block.m(t1.parentNode, t1);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_2.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
			if (detaching) detach(t0);
			if (if_block) if_block.d(detaching);
			if (detaching) detach(t1);
			if (detaching) detach(hr);
		}
	};
}

// (132:4) {#if $viewStore.selectedTags.length > 0}
function create_if_block(ctx) {
	let strong;
	let t1;
	let div;
	let t2;
	let ul;
	let each_value = /*$viewStore*/ ctx[5].allMatchingFiles;
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			strong = element("strong");
			strong.textContent = "All notes";
			t1 = space();
			div = element("div");
			t2 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			attr(div, "class", "spacer svelte-1srsbn2");
			attr(ul, "class", "svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, strong, anchor);
			insert(target, t1, anchor);
			insert(target, div, anchor);
			insert(target, t2, anchor);
			insert(target, ul, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}
		},
		p(ctx, dirty) {
			if (dirty[0] & /*openFile, $viewStore*/ 160) {
				each_value = /*$viewStore*/ ctx[5].allMatchingFiles;
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(ul, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		d(detaching) {
			if (detaching) detach(strong);
			if (detaching) detach(t1);
			if (detaching) detach(div);
			if (detaching) detach(t2);
			if (detaching) detach(ul);
			destroy_each(each_blocks, detaching);
		}
	};
}

// (136:8) {#each $viewStore.allMatchingFiles as file}
function create_each_block(ctx) {
	let li;
	let t_value = /*file*/ ctx[23].basename + "";
	let t;
	let mounted;
	let dispose;

	function click_handler_11(...args) {
		return /*click_handler_11*/ ctx[19](/*file*/ ctx[23], ...args);
	}

	return {
		c() {
			li = element("li");
			t = text(t_value);
			attr(li, "class", "note link svelte-1srsbn2");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, t);

			if (!mounted) {
				dispose = listen(li, "click", click_handler_11);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*$viewStore*/ 32 && t_value !== (t_value = /*file*/ ctx[23].basename + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(li);
			mounted = false;
			dispose();
		}
	};
}

function create_fragment(ctx) {
	let div10;
	let div9;
	let div2;
	let div0;
	let tagtitle0;
	let t0;
	let t1;
	let p0;
	let t2_value = /*$viewStore*/ ctx[5].allMatchingFiles.length + "";
	let t2;
	let t3;
	let t4;
	let div1;
	let tagtitle1;
	let t5;
	let hr0;
	let t6;
	let div8;
	let div4;
	let p1;
	let t8;
	let div3;
	let t9;
	let t10;
	let div5;
	let t11;
	let div7;
	let p2;
	let t13;
	let div6;
	let t14;
	let t15;
	let hr1;
	let t16;
	let t17;
	let div9_style_value;
	let div10_resize_listener;
	let current;
	let mounted;
	let dispose;
	tagtitle0 = new TagTitle({ props: { tag: "All Tags" } });
	let each_value_7 = /*$viewStore*/ ctx[5].selectedTags;
	let each_blocks_2 = [];

	for (let i = 0; i < each_value_7.length; i += 1) {
		each_blocks_2[i] = create_each_block_7(get_each_context_7(ctx, each_value_7, i));
	}

	const out = i => transition_out(each_blocks_2[i], 1, 1, () => {
		each_blocks_2[i] = null;
	});

	tagtitle1 = new TagTitle({ props: { tag: "A/A" } });
	let each_value_6 = /*$viewStore*/ ctx[5].allGroups;
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_6.length; i += 1) {
		each_blocks_1[i] = create_each_block_6(get_each_context_6(ctx, each_value_6, i));
	}

	const out_1 = i => transition_out(each_blocks_1[i], 1, 1, () => {
		each_blocks_1[i] = null;
	});

	let each_value_5 = /*$viewStore*/ ctx[5].allTags;
	let each_blocks = [];

	for (let i = 0; i < each_value_5.length; i += 1) {
		each_blocks[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
	}

	const out_2 = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	let if_block0 = /*$viewStore*/ ctx[5].allMatchingFiles.length > 3 && create_if_block_1(ctx);
	let if_block1 = /*$viewStore*/ ctx[5].selectedTags.length > 0 && create_if_block(ctx);

	return {
		c() {
			div10 = element("div");
			div9 = element("div");
			div2 = element("div");
			div0 = element("div");
			create_component(tagtitle0.$$.fragment);
			t0 = space();

			for (let i = 0; i < each_blocks_2.length; i += 1) {
				each_blocks_2[i].c();
			}

			t1 = space();
			p0 = element("p");
			t2 = text(t2_value);
			t3 = text(" notes");
			t4 = space();
			div1 = element("div");
			create_component(tagtitle1.$$.fragment);
			t5 = space();
			hr0 = element("hr");
			t6 = space();
			div8 = element("div");
			div4 = element("div");
			p1 = element("p");
			p1.textContent = "Groups:";
			t8 = space();
			div3 = element("div");
			t9 = space();

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t10 = space();
			div5 = element("div");
			t11 = space();
			div7 = element("div");
			p2 = element("p");
			p2.textContent = "Tags:";
			t13 = space();
			div6 = element("div");
			t14 = space();

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t15 = space();
			hr1 = element("hr");
			t16 = space();
			if (if_block0) if_block0.c();
			t17 = space();
			if (if_block1) if_block1.c();
			attr(div0, "class", "link svelte-1srsbn2");
			attr(p0, "class", "muted small svelte-1srsbn2");
			set_style(p0, "margin-left", "10px");
			set_style(p0, "align-self", "flex-end");
			set_style(div1, "visibility", "hidden");
			attr(div1, "class", "svelte-1srsbn2");
			attr(div2, "class", "path svelte-1srsbn2");
			attr(p1, "class", "small muted label svelte-1srsbn2");
			attr(div3, "class", "spacer svelte-1srsbn2");
			attr(div4, "class", "flex align-center svelte-1srsbn2");
			attr(div5, "class", "spacer svelte-1srsbn2");
			attr(p2, "class", "small muted label svelte-1srsbn2");
			attr(div6, "class", "spacer svelte-1srsbn2");
			attr(div7, "class", "flex align-center svelte-1srsbn2");
			attr(div8, "class", "hscroll svelte-1srsbn2");
			attr(div9, "style", div9_style_value = "width: " + /*contentWidth*/ ctx[4] + "px; margin: 0 auto;");
			add_render_callback(() => /*div10_elementresize_handler*/ ctx[20].call(div10));
		},
		m(target, anchor) {
			insert(target, div10, anchor);
			append(div10, div9);
			append(div9, div2);
			append(div2, div0);
			mount_component(tagtitle0, div0, null);
			append(div2, t0);

			for (let i = 0; i < each_blocks_2.length; i += 1) {
				each_blocks_2[i].m(div2, null);
			}

			append(div2, t1);
			append(div2, p0);
			append(p0, t2);
			append(p0, t3);
			append(div2, t4);
			append(div2, div1);
			mount_component(tagtitle1, div1, null);
			append(div9, t5);
			append(div9, hr0);
			append(div9, t6);
			append(div9, div8);
			append(div8, div4);
			append(div4, p1);
			append(div4, t8);
			append(div4, div3);
			append(div4, t9);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].m(div4, null);
			}

			append(div8, t10);
			append(div8, div5);
			append(div8, t11);
			append(div8, div7);
			append(div7, p2);
			append(div7, t13);
			append(div7, div6);
			append(div7, t14);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div7, null);
			}

			append(div9, t15);
			append(div9, hr1);
			append(div9, t16);
			if (if_block0) if_block0.m(div9, null);
			append(div9, t17);
			if (if_block1) if_block1.m(div9, null);
			div10_resize_listener = add_resize_listener(div10, /*div10_elementresize_handler*/ ctx[20].bind(div10));
			current = true;

			if (!mounted) {
				dispose = listen(div0, "click", /*click_handler*/ ctx[8]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (dirty[0] & /*viewStore, $viewStore*/ 34) {
				each_value_7 = /*$viewStore*/ ctx[5].selectedTags;
				let i;

				for (i = 0; i < each_value_7.length; i += 1) {
					const child_ctx = get_each_context_7(ctx, each_value_7, i);

					if (each_blocks_2[i]) {
						each_blocks_2[i].p(child_ctx, dirty);
						transition_in(each_blocks_2[i], 1);
					} else {
						each_blocks_2[i] = create_each_block_7(child_ctx);
						each_blocks_2[i].c();
						transition_in(each_blocks_2[i], 1);
						each_blocks_2[i].m(div2, t1);
					}
				}

				group_outros();

				for (i = each_value_7.length; i < each_blocks_2.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if ((!current || dirty[0] & /*$viewStore*/ 32) && t2_value !== (t2_value = /*$viewStore*/ ctx[5].allMatchingFiles.length + "")) set_data(t2, t2_value);

			if (dirty[0] & /*$settingsStore, $viewStore, settingsStore*/ 97) {
				each_value_6 = /*$viewStore*/ ctx[5].allGroups;
				let i;

				for (i = 0; i < each_value_6.length; i += 1) {
					const child_ctx = get_each_context_6(ctx, each_value_6, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
						transition_in(each_blocks_1[i], 1);
					} else {
						each_blocks_1[i] = create_each_block_6(child_ctx);
						each_blocks_1[i].c();
						transition_in(each_blocks_1[i], 1);
						each_blocks_1[i].m(div4, null);
					}
				}

				group_outros();

				for (i = each_value_6.length; i < each_blocks_1.length; i += 1) {
					out_1(i);
				}

				check_outros();
			}

			if (dirty[0] & /*$settingsStore, $viewStore, settingsStore*/ 97) {
				each_value_5 = /*$viewStore*/ ctx[5].allTags;
				let i;

				for (i = 0; i < each_value_5.length; i += 1) {
					const child_ctx = get_each_context_5(ctx, each_value_5, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_5(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div7, null);
					}
				}

				group_outros();

				for (i = each_value_5.length; i < each_blocks.length; i += 1) {
					out_2(i);
				}

				check_outros();
			}

			if (/*$viewStore*/ ctx[5].allMatchingFiles.length > 3) {
				if (if_block0) {
					if_block0.p(ctx, dirty);

					if (dirty[0] & /*$viewStore*/ 32) {
						transition_in(if_block0, 1);
					}
				} else {
					if_block0 = create_if_block_1(ctx);
					if_block0.c();
					transition_in(if_block0, 1);
					if_block0.m(div9, t17);
				}
			} else if (if_block0) {
				group_outros();

				transition_out(if_block0, 1, 1, () => {
					if_block0 = null;
				});

				check_outros();
			}

			if (/*$viewStore*/ ctx[5].selectedTags.length > 0) {
				if (if_block1) {
					if_block1.p(ctx, dirty);
				} else {
					if_block1 = create_if_block(ctx);
					if_block1.c();
					if_block1.m(div9, null);
				}
			} else if (if_block1) {
				if_block1.d(1);
				if_block1 = null;
			}

			if (!current || dirty[0] & /*contentWidth*/ 16 && div9_style_value !== (div9_style_value = "width: " + /*contentWidth*/ ctx[4] + "px; margin: 0 auto;")) {
				attr(div9, "style", div9_style_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle0.$$.fragment, local);

			for (let i = 0; i < each_value_7.length; i += 1) {
				transition_in(each_blocks_2[i]);
			}

			transition_in(tagtitle1.$$.fragment, local);

			for (let i = 0; i < each_value_6.length; i += 1) {
				transition_in(each_blocks_1[i]);
			}

			for (let i = 0; i < each_value_5.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			transition_in(if_block0);
			current = true;
		},
		o(local) {
			transition_out(tagtitle0.$$.fragment, local);
			each_blocks_2 = each_blocks_2.filter(Boolean);

			for (let i = 0; i < each_blocks_2.length; i += 1) {
				transition_out(each_blocks_2[i]);
			}

			transition_out(tagtitle1.$$.fragment, local);
			each_blocks_1 = each_blocks_1.filter(Boolean);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				transition_out(each_blocks_1[i]);
			}

			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			transition_out(if_block0);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div10);
			destroy_component(tagtitle0);
			destroy_each(each_blocks_2, detaching);
			destroy_component(tagtitle1);
			destroy_each(each_blocks_1, detaching);
			destroy_each(each_blocks, detaching);
			if (if_block0) if_block0.d();
			if (if_block1) if_block1.d();
			div10_resize_listener();
			mounted = false;
			dispose();
		}
	};
}

const columnWidth = 250;
const columnMargin = 20;

function instance($$self, $$props, $$invalidate) {
	let columns;
	let contentWidth;

	let $viewStore,
		$$unsubscribe_viewStore = noop,
		$$subscribe_viewStore = () => ($$unsubscribe_viewStore(), $$unsubscribe_viewStore = subscribe(viewStore, $$value => $$invalidate(5, $viewStore = $$value)), viewStore);

	let $settingsStore,
		$$unsubscribe_settingsStore = noop,
		$$subscribe_settingsStore = () => ($$unsubscribe_settingsStore(), $$unsubscribe_settingsStore = subscribe(settingsStore, $$value => $$invalidate(6, $settingsStore = $$value)), settingsStore);

	$$self.$$.on_destroy.push(() => $$unsubscribe_viewStore());
	$$self.$$.on_destroy.push(() => $$unsubscribe_settingsStore());

	var __awaiter = this && this.__awaiter || function (thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P
			? value
			: new P(function (resolve) {
						resolve(value);
					});
		}

		return new (P || (P = Promise))(function (resolve, reject) {
				function fulfilled(value) {
					try {
						step(generator.next(value));
					} catch(e) {
						reject(e);
					}
				}

				function rejected(value) {
					try {
						step(generator["throw"](value));
					} catch(e) {
						reject(e);
					}
				}

				function step(result) {
					result.done
					? resolve(result.value)
					: adopt(result.value).then(fulfilled, rejected);
				}

				step((generator = generator.apply(thisArg, _arguments || [])).next());
			});
	};

	
	let { settingsStore } = $$props;
	$$subscribe_settingsStore();
	let { viewStore } = $$props;
	$$subscribe_viewStore();
	const totalColumnWidth = columnWidth + columnMargin * 2;
	let clientWidth;

	function openFile(e, file) {
		return __awaiter(this, void 0, void 0, function* () {
			let inNewSplit = obsidian.Keymap.isModEvent(e);
			const mode = window.app.vault.getConfig("defaultViewMode");

			const leaf = inNewSplit
			? window.app.workspace.splitActiveLeaf()
			: window.app.workspace.getUnpinnedLeaf();

			yield leaf.openFile(file, { active: true, mode });
		});
	}

	onMount(() => {
		// Ensures we've loaded everything when presented
		viewStore.selectTags($viewStore.selectedTags);
	});

	const click_handler = _ => viewStore.selectTags([]);

	const click_handler_1 = (tag, index, e) => obsidian.Keymap.isModEvent(e)
	? viewStore.selectTags([tag])
	: viewStore.selectTags($viewStore.selectedTags.slice(0, index + 1));

	const click_handler_2 = (label, e) => {
		e.stopPropagation();
		settingsStore.toggleFavoriteGroup(label);
	};

	const click_handler_3 = (label, _) => settingsStore.toggleExcludedGroup(label);

	const click_handler_4 = (label, e) => {
		e.stopPropagation();
		settingsStore.toggleFavoriteTag(label);
	};

	const click_handler_5 = (label, _) => settingsStore.toggleExcludedTag(label);
	const click_handler_6 = (tag, _) => viewStore.selectTags([...$viewStore.selectedTags, tag]);
	const click_handler_7 = (tag, tag2, _) => viewStore.selectTags([...$viewStore.selectedTags, tag, tag2]);
	const click_handler_8 = (file, e) => openFile(e, file);
	const click_handler_9 = (label, _) => viewStore.toggleExpandedGroup(label);
	const click_handler_10 = (label, _) => viewStore.toggleExpandedGroup(label);
	const click_handler_11 = (file, e) => openFile(e, file);

	function div10_elementresize_handler() {
		clientWidth = this.clientWidth;
		$$invalidate(2, clientWidth);
	}

	$$self.$$set = $$props => {
		if ("settingsStore" in $$props) $$subscribe_settingsStore($$invalidate(0, settingsStore = $$props.settingsStore));
		if ("viewStore" in $$props) $$subscribe_viewStore($$invalidate(1, viewStore = $$props.viewStore));
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty[0] & /*clientWidth*/ 4) {
			$$invalidate(3, columns = Math.max(1, Math.trunc(clientWidth / totalColumnWidth)));
		}

		if ($$self.$$.dirty[0] & /*columns*/ 8) {
			$$invalidate(4, contentWidth = columns * totalColumnWidth);
		}
	};

	return [
		settingsStore,
		viewStore,
		clientWidth,
		columns,
		contentWidth,
		$viewStore,
		$settingsStore,
		openFile,
		click_handler,
		click_handler_1,
		click_handler_2,
		click_handler_3,
		click_handler_4,
		click_handler_5,
		click_handler_6,
		click_handler_7,
		click_handler_8,
		click_handler_9,
		click_handler_10,
		click_handler_11,
		div10_elementresize_handler
	];
}

class TagMenu extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-1srsbn2-style")) add_css();
		init(this, options, instance, create_fragment, safe_not_equal, { settingsStore: 0, viewStore: 1 }, [-1, -1]);
	}
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

class CRNView extends obsidian.ItemView {
    constructor(leaf, settingsStore, tagMenuStore) {
        super(leaf);
        this.settingsStore = settingsStore;
        this.tagMenuStore = tagMenuStore;
    }
    getViewType() {
        return VIEW_TYPE;
    }
    getDisplayText() {
        return "Tag Navigator";
    }
    getIcon() {
        return "go-to-file";
    }
    getEphemeralState() {
        const state = get_store_value(this.tagMenuStore);
        return {
            selectedTags: state.selectedTags,
            expandedGroups: state.expandedGroups
        };
    }
    setEphemeralState(state) {
        if (state) {
            this.tagMenuStore.loadState(state.selectedTags, state.expandedGroups);
        }
    }
    onClose() {
        if (this.tagMenu) {
            this.tagMenu.$destroy();
        }
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        return Promise.resolve();
    }
    onOpen() {
        this.tagMenu = new TagMenu({
            target: this.contentEl,
            props: {
                settingsStore: this.settingsStore,
                viewStore: this.tagMenuStore,
            },
        });
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.unsubscribe = this.tagMenuStore.subscribe(_ => {
            this.app.workspace.requestSaveLayout();
        });
        return Promise.resolve();
    }
}

const defaultSettings = {
    excludedGroups: [],
    excludedTags: [],
    favoriteGroups: ["status", "activity", "type"],
    favoriteTags: []
};
async function createSettingsStore(plugin) {
    const initialData = await plugin.loadData();
    const { subscribe, update } = writable(Object.assign(Object.assign({}, defaultSettings), initialData));
    function toggleExcludedGroup(group) {
        update(settings => {
            const excludedGroups = settings.excludedGroups;
            const index = excludedGroups.indexOf(group);
            if (index > -1) {
                excludedGroups.splice(index, 1);
            }
            else {
                excludedGroups.push(group);
            }
            const newState = Object.assign(Object.assign({}, settings), { excludedGroups });
            plugin.saveData(newState);
            return newState;
        });
    }
    function toggleExcludedTag(tag) {
        update(settings => {
            const excludedTags = settings.excludedTags;
            const index = excludedTags.indexOf(tag);
            if (index > -1) {
                excludedTags.splice(index, 1);
            }
            else {
                excludedTags.push(tag);
            }
            const newState = Object.assign(Object.assign({}, settings), { excludedTags });
            plugin.saveData(newState);
            return newState;
        });
    }
    function toggleFavoriteGroup(group) {
        update(settings => {
            const favoriteGroups = settings.favoriteGroups;
            const index = favoriteGroups.indexOf(group);
            if (index > -1) {
                favoriteGroups.splice(index, 1);
            }
            else {
                favoriteGroups.push(group);
            }
            const newState = Object.assign(Object.assign({}, settings), { favoriteGroups });
            plugin.saveData(newState);
            return newState;
        });
    }
    function toggleFavoriteTag(tag) {
        update(settings => {
            const favoriteTags = settings.favoriteTags;
            const index = favoriteTags.indexOf(tag);
            if (index > -1) {
                favoriteTags.splice(index, 1);
            }
            else {
                favoriteTags.push(tag);
            }
            const newState = Object.assign(Object.assign({}, settings), { favoriteTags });
            plugin.saveData(newState);
            return newState;
        });
    }
    return {
        subscribe,
        toggleExcludedGroup,
        toggleExcludedTag,
        toggleFavoriteGroup,
        toggleFavoriteTag
    };
}
function generateInitialTagMenuState() {
    return {
        allGroups: [],
        allTags: [],
        toShow: {},
        groupsSorted: [],
        tagsSorted: {},
        crossrefsSorted: {},
        allMatchingFiles: [],
        selectedTags: [],
        expandedGroups: [""] // always expand ungrouped tags section
    };
}
function createTagMenuStore(settingsStore) {
    const { subscribe, set, update } = writable(generateInitialTagMenuState());
    function selectTags(selectTags) {
        const newState = generateInitialTagMenuState();
        newState.selectedTags = selectTags;
        const groupCounts = {};
        const tagCounts = {};
        const settingsState = get_store_value(settingsStore);
        const allFiles = window.app.vault.getMarkdownFiles();
        const allFileTags = {};
        allFiles.forEach(file => {
            const fileTags = obsidian.getAllTags(window.app.metadataCache.getFileCache(file));
            allFileTags[file.name] = fileTags;
            if (selectTags.every(t => fileTags.includes(t))) {
                newState.allMatchingFiles.push(file);
                fileTags.forEach(tag => {
                    if (selectTags.includes(tag)) {
                        return;
                    }
                    const parts = tagParts(tag);
                    const label = parts.label || "";
                    const title = parts.title;
                    if (label.length > 0 && !newState.allGroups.includes(label)) {
                        newState.allGroups.push(label);
                    }
                    if (label.length < 1 && !newState.allTags.includes(tag)) {
                        newState.allTags.push(tag);
                    }
                    if (settingsState.excludedGroups.includes(label)) {
                        return;
                    }
                    if (settingsState.excludedTags.includes(tag)) {
                        return;
                    }
                    if (!newState.toShow[label]) {
                        newState.toShow[label] = {};
                    }
                    if (!newState.toShow[label][tag]) {
                        newState.toShow[label][tag] = { displayName: title, files: [], crossrefs: {} };
                    }
                    newState.toShow[label][tag].files.push(file);
                    if (!tagCounts[label]) {
                        tagCounts[label] = {};
                    }
                    groupCounts[label] = (groupCounts[label] || 0) + 1;
                    tagCounts[label][tag] = (tagCounts[label][tag] || 0) + 1;
                });
            }
        });
        newState.allGroups.sort();
        newState.allTags.sort();
        // Generate groupsSorted
        newState.groupsSorted = Object.keys(newState.toShow).sort((a, b) => (groupCounts[b] + Object.keys(tagCounts[b] || {}).length) - (groupCounts[a] + Object.keys(tagCounts[a] || {}).length)); // tagCounts included to prioritize groups that have more columns
        const _favoriteGroups = settingsState.favoriteGroups.sort((a, b) => ((groupCounts[a] || 0) + Object.keys(tagCounts[a] || {}).length) - ((groupCounts[b] || 0)) + Object.keys(tagCounts[b] || {}).length);
        _favoriteGroups.forEach(group => {
            const index = newState.groupsSorted.indexOf(group);
            if (index > -1) {
                newState.groupsSorted.splice(index, 1);
                newState.groupsSorted.unshift(group);
            }
        });
        // Put list of all ungrouped tags at bottom, it will always be expanded
        const index = newState.groupsSorted.indexOf("");
        if (index > -1) {
            newState.groupsSorted.splice(index, 1);
            newState.groupsSorted.push("");
        }
        // Put list of favorite tags at top
        if (settingsState.favoriteTags.length > 0 && newState.toShow[""]) {
            newState.groupsSorted.unshift("favorite tags");
            newState.toShow["favorite tags"] = {};
            tagCounts["favorite tags"] = {};
            settingsState.favoriteTags.forEach(tag => {
                if (newState.toShow[""][tag]) {
                    newState.toShow["favorite tags"][tag] = newState.toShow[""][tag];
                    delete newState.toShow[""][tag];
                    tagCounts["favorite tags"][tag] = tagCounts[""][tag];
                    delete tagCounts[""][tag];
                }
            });
        }
        // Generate tagsSorted, crossrefs
        Object.keys(newState.toShow).forEach(group => {
            newState.tagsSorted[group] = Object.keys(newState.toShow[group]).sort((a, b) => tagCounts[group][b] - tagCounts[group][a]);
            Object.keys(newState.toShow[group]).forEach(tag => {
                const files = newState.toShow[group][tag].files;
                const crossrefs = {};
                files.forEach(file => {
                    allFileTags[file.name].forEach(tag2 => {
                        if (tag2 === tag) {
                            return;
                        }
                        if (selectTags.includes(tag2)) {
                            return;
                        }
                        crossrefs[tag2] = (crossrefs[tag2] || 0) + 1;
                    });
                });
                newState.toShow[group][tag].crossrefs = crossrefs;
            });
        });
        // Generate crossrefsSorted
        Object.keys(newState.toShow).forEach(group => {
            newState.crossrefsSorted[group] = {};
            Object.keys(newState.toShow[group]).forEach(tag => {
                const crossrefs = newState.toShow[group][tag].crossrefs;
                const sorted = Object.keys(crossrefs).sort((a, b) => crossrefs[b] - crossrefs[a]);
                sorted.slice().reverse().forEach(tag => {
                    if (settingsState.favoriteTags.find(ftag => tag === ftag)
                        || settingsState.favoriteGroups.find(fgroup => tag.startsWith("#" + fgroup))) {
                        sorted.splice(sorted.indexOf(tag), 1);
                        sorted.unshift(tag);
                    }
                });
                newState.crossrefsSorted[group][tag] = sorted;
            });
        });
        set(newState);
    }
    function toggleExpandedGroup(group) {
        update(state => {
            const expandedGroups = state.expandedGroups;
            const index = expandedGroups.indexOf(group);
            if (index > -1) {
                expandedGroups.splice(index, 1);
            }
            else {
                expandedGroups.push(group);
            }
            return Object.assign(Object.assign({}, state), { expandedGroups });
        });
    }
    function loadState(selectedTags, expandedGroups) {
        if (selectedTags) {
            selectTags(selectedTags);
        }
        if (expandedGroups) {
            update(state => (Object.assign(Object.assign({}, state), { expandedGroups })));
        }
    }
    const unsubscribe = settingsStore.subscribe(_ => {
        selectTags(get_store_value({ subscribe }).selectedTags);
    });
    const destroy = unsubscribe;
    return { subscribe, destroy, loadState, selectTags, toggleExpandedGroup };
}

class CrossNavPlugin extends obsidian.Plugin {
    onunload() {
        this.app.workspace
            .getLeavesOfType(VIEW_TYPE)
            .forEach((leaf) => leaf.detach());
        this.tagMenuStore.destroy();
    }
    async onload() {
        this.settingsStore = await createSettingsStore(this);
        this.tagMenuStore = createTagMenuStore(this.settingsStore);
        this.registerView(VIEW_TYPE, (leaf) => (this.view = new CRNView(leaf, this.settingsStore, this.tagMenuStore)));
        this.addCommand({
            id: "show-refnav-view",
            name: "Open Tag Navigator",
            callback: () => {
                const leaf = this.app.workspace.activeLeaf;
                leaf.open(new CRNView(leaf, this.settingsStore, this.tagMenuStore));
            },
        });
    }
}

module.exports = CrossNavPlugin;
