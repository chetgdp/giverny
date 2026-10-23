# DevLog

## name
uh oh well Pithos is already a thing for an object store file format. The large Greek earthenware jar for long term storage makes sense as the fundamental storageobject for the digital age primitive. Our `.html` are not the wine, grain and oiltypes of primitives that object storage is, it's more specific. What this tool is, is not the format but the printing press of the format.

```
holocron
htmlpack
```
The human brain loves stories. The Holographic Chronicle or holocron is compelling in that aspect and directly leads to the holotube. We have to avoid the copyright name though? What builds a holocron? 

Words for things that make other things with greek translation
```
Loom → Histos (ἱστός) - weaves threads together (strings?)
Spindle → Atraktos (ἄτρακτος) - spins/twists fibers into thread
Kiln → Kaminos (κάμινος) - hardens clay into pottery, furnace
Forge → Chalkeia (χαλκεῖα) - smithy, or Chalkeus (χαλκεύς) - smith/forger
Crucible → Choneutes (χωνευτής) - smelting pot, melting vessel
```

Histos has a certain quality to it, similar to why Pithos sounds good. However, there is a mythological element here, what this tool does is weave many `String` threads together. It's beautiful, elegant and simple. The final fabric is a long utf-8 string that represents an `html` file. Also it's available on crates.io.

---

# The Refactor towards Group Element Thinking
*moving from N to N+1 or Data Oriented Design*

## Notes on N+2 Programming
[Casey Muratori - Becoming an N+2 Programmer](https://www.youtube.com/watch?v=xt1KNDmOYqA)

This is a Rust project. You may think that the evil borrow checker forces you to think in a N style, use smart pointers and the like to make it happy. This friction you feel when coming up against the borrow checker is actually evolutionary pressure guiding you towards the N+1 style.

Currently the code I have written is very N style. Everything is very one note, individual pieces coming together to get packed. 

I am team big struct now. 

We should have a big struct that represents the totality of what is being packed. Everything in place, then it is fetched and fprintf'd simulatenously.

## Notes on Data Oriented Design
[Mike Acton - Data Oriented Design](https://www.youtube.com/watch?v=rX0ItVEVjHc)

The purpose of all program and all parts of those programs; to transform data from one form to another.

**Informatics**

There is a physicality to this computation concept. It is not a pure theory like Computer Scientists would have you believe. 0 or 1, electricity.

Understand Data = Understand Problem. And vice versa. Diff problems, diff solutions.

Understand the Cost of solution. Hardware has a cost.

Everything is a *data* problem. Not a code problem.

Where there is one, there are many. Do not trap yourself in a vacuum.

Lies: 
- Software is a platform. 
- Code designed around a model of the world.
- Code is more important than data.

A programmers job is not to write code. It is to solve data transformation problems.

Solve for the common case, not the generic case.

L1,L2,L3,RAM access gets slower quadratically.

CPU often waits for Memory.

Compiler is a tool, not a magic wand.

Think about cache lines/blocks. 64 bytes.

Truths:
- Hardware is the platform.
- Design around the data, not an idealized world.
- Transform data, solve that, not code design.

Some pushback to refine this further from my perspective. 

What if you don't have a clear finite range? What if portability is your problem? 
There are many well designed abstraction that can be considered platforms. Think about the Java Virtual Machine, or the WebAssembly Stack-Based Virtual Machine or the WebGPU standard.

The platform is the platform, not hardware or software but both. Even the hardware you think you're programming for has some level of software abstraction such as firmware and microcode. Especially modern chips with dynamic scheduling, branch prediction and speculative execution (whacky non determinism).

Design your data transformation with a clear understanding of the reality your platform constraints.

---

There is a term I have seen floating around in programming circles: 

> *Make it work. Make it right. Make it fast.*

Then there is: 

> *Move fast and break things. Ship ship ship. The Continuous delivery mindset.*

This is what happens when you mostly stick to *"Make it work"*. The agile development method in true form, always shipping features, moving along. This comes at the cost of *Make it right* and *Make it fast* (which is why all of our software is slow and bloated). Why do we stick to this? It's all incentives. The profit motive wills it.

In the AI age, software is going to be developed *blazingly fast*, and there will be nobody to fix it except for the bet on future AI systems being more powerful and they'll just clean it up. The most extreme justification for kicking the tech debt can down the road I have ever seen. You can keep moving this fast but your developers won't know what they are implementing. They might be apt at solving the data transformation problem and giving the AI instructions on how to implement that code but they won't be spending time reviewing and making sure it is correct. They won't have the system in mind as they continue developing. This will lead to degradation, this will slow you down massively inthe future, you are praying that AG(od)I will come to this earth and deliver you from sin.

I'm going to invert this, add my spin on it. The anti-thesis to the silicon valley dogma:

> *Slow is smooth. Smooth is fast.*

You can do a hybrid version of agile that will remove all tech debt before it piles up. After every feature, aka *Make it work* sprint, you engage in a *Make it right* sprint. It's that simple. In fact, most of the time doing *Make it right* will get you 90% of the way through *Make it fast*. If you have strict performance requirements, making it fast is making it right. 

But now looking at the other end. Why engage in this cycle of make it work -> right? Why not just start with *Make it right*? What you end up figuring out, is that you can actually move faster by making it right from the beginning. The speed you gain from "Make it work" quick plumbing library connecting ez pz fake engineering, only bogs you down later. Software development is a a marathon, not a sprint. Actually nothing is a sprint, every project is at the very least a 5k/10k run, pace yourself.

This comes back to focusing on solving data transformation problems. You need to have a profound clarity of mind, the ability to see the system in your head. 

I:

enjoy solving data transformation problems

enjoy implementing my programs by hand (coding)

find that LLMs are unreliable programmers

find that LLMs are decent coders if given specifications

fidn that LLMs are realiable at showing you programming language syntax that you don't know via snippets.

the instructions and specifications given to an LLM also work for you or any other programmer. they are steps to solving the data transformation problems. 

find that coding by hand allows me to solve the data transformation problems better. Seeing the system in my mind as it gets implemented. This clarity gives me a focus and momentum that is missing if an LLM performs the implementation task.

when you don't implement by hand you don't see how the pieces fit together. 

when you don't see how the pieces fit together, you can't build a mental model meaning you don't understand the system.

you can not be a reliable tech lead for LLMs if you don't understand the system. 

on the other hand. LLMs are fantastic tools for exploring and iterating on the conceptual space that a data transformation problems falls into. 

LLMs are fantastic at giving you code snippets. 

I ask LLMs to write out code sometimes and I still type it out myself. No copy pasting. As you type you conceptualize the system. 

now, with that all said, it's time to try Claude Opus 4.5

---

```
/*
* test.rs
*
* testing refactor
*/

/*
what is the data transformation?
what is the data?

well it's all String really, utf-8.

the input is a config that describes the location of our Strings that we want to create a String utf-8 document out of

Config -> Fetch String -> Html combined String

The data transformation problem we are solving is the dependency problem.

What a single index.html usually does is use hyperlinks to fetch the other resources

We are inlining the resources and compiling them. 

An Html Compiler is what we are making. In the less technical sense. 
A packer? Bringing various sources together.

Therefore, a big struct containing all the strings

We are kind of building it out backwards

there needs to be an intermediate step for the fetching of the Strings

and also the processing of the wasm binary and favicon that we encode

also potentially other resources like fonts, images, etc

right now we have

CLI structs -> Config structs -> fn pack() -> maud html template

is the config struct our intermediate already?

that is where the location of all the assets is already located

we have the assetsource thing going on and it decides how to fetch

let's break this down more

we fetch, this a local file handle or an http request

we encode, this is either no encoding, base64 or brotli + base64

this is the fundamental data transformation

hmm

Actually the CLI + config isn't the only way we might want to build.

The API should allow you to programmatically build out the html.

The CLI consumes the API? That's why we have the intermediate config structs?
*/

//anything else go in here?
pub struct HtmlDoc {
    // head
    // metadata
    pub title: String, // defaults
    pub author: String,
    pub description: String,

    // head assets
    pub favicon: ,
    pub css: String,
    
    // javascript no modules
    pub scripts: String,

    // html snippets
    pub html_shards: ,

    // binary assets
    pub wasm_modules: ,
}

// or a more hierachical style
as seen in html.rs
```

So far the refactor has been going along well. 

> Input -> |Data Tansformation| -> Output

We decided to start by refactoring the output. What is the output? An html file is a string. How do we build that string? We put all the pieces together. What are the pieces? A bunch of strings within a hierarchy, we call this `HtmlDoc`, made from Head which contains Metadata and Body. (This might be able to be reworked more intelligently to accomodate for more niche html tags and added snippets). 

We render `HtmlDoc` using `Maud` from an `impl` and some imperative functions. Saving the final `PackedHtml` to a file.

This is the output coming together and it feels good.

Now we have a mess in the main `packer.rs`, but we will ignore that for now using our old string and ductape method. Why? Because the middle of the pipeline is not so obvious without knowing both the input and output.

Let's focus on the input now. We have a `Yaml` config that we parse using `serde`. The config is how we describe the pieces that we want to put together. 

```yaml
# this is an example config
pack:
  # this option enables the core runtime environment that i have built
  # core.js and wasm_decoder for brotli decode of wasm_modules
  runtime:
    enabled: true
    icon: false
    core: true
    decoder: true
  # metadata that could be exapanded
  meta:
    title: "pithos"
    author: "me"
    description: "packed by pithos"
    keywords: "hello from the yaml file"
  favicon:
    - ./core/icon.svg"
  css:
    - "https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css"
  # this part is innefficient
  # all you should need for this is a path to the directory
  scripts:
    #none
  wasm:
    module:
      compile_wasm: false
      binary: "../wasm_modules/pkg/wasm_modules_bg.wasm"
      glue: "../wasm_modules/pkg/wasm_modules.js"
      # currently this module needs to be called bin-wasm-app
      # for the core.js to load it properly
      id: "bin-wasm-app"
      compression: "brotli"
```

This is a recipe for how everything should be built. But there are lots of options, and we need to make use of the `Option<>` in Rust. So this leads us to using an intermediate config representation with no options and nice defaults, this is good because it allows us to implement a way to build the config using an API.

Let's think about how we construct the Yaml. Metadata should all be optional, same with CSS, the Html snippets and javascript. The bulk of what this program is doing is enabling inlined Wasm and the default runtime loading it. Therefore it must be ergonomic to use. The current runtime setup seems good to me, choosing what is enabled. However I wonder if the options  in wasm: module: and how many modules you add if more than one should work together with the default runtime. This is actually kind of the fundamental data transformation problem. What does the user want to pack, how do they express it, what works by default, how does the program conform to the user? Solve for the common case, one module is default that's what the runtime enables. The rest of the options are what enabled non-default custom user runtimes (which we will explain how to setup in docs). 

We learned about `impl From<TypeA> for TypeB { fn from() }` which enables us to do `type_b: TypeB = type_a.into()` with all of our defaults setup. The solution feels quite elegant, we load the yaml file and transform it into a working config.

So, we finally have the input and the output setup. Next up is bulk of the data transformation. The builder, resolver, fetcher, encoder, need a better name for this, but alas, what does it do?

- fetch based on `AssetSource`
    - local file path: file handle
    - remote url: http request
- compile wasm if enabled
    - find path
- encode -> EncodedWasm or EncodedIcon
    - base64: icon
    - base64 + brotli: wasm binary
- insert default runtime assets
 
One key thing we also need to implement is allowing `module: path:` to be the single source for finding the wasm binary and the javascript glue files in pkg. This path would also be how the program knows where to compile. It looks for a `Cargo.toml` for the compilation and a `pkg`. But let's put this aside for the moment and solve the bigger problem.

```
        | compile   | fetch     | concat    | compress  | encode    | string    |
metadata|           |           |           |           |           |   x       |
favicon |           |   x       |           |           |   x       |   x       |
styles  |           |   x       |   x       |           |           |   x       |
scripts |           |   x       |           |           |           |   x       |
html    |           |   x       |           |           |           |   x       |
wasm    |   x       |   x       |           |   x       |   x       |   x       |
```

These are the operations that need to occur, the bulk of what is occuring is the fetch. The most time consuming operations are compilation and brotli compression.

Let's solve the main problem first then, the fetch. There are two types of fetch we have to do. Either http request for a remote resource or a local file read. We should do each group in parallel? No sequential first for ease of implementation.

```
// operation 1 COMPILE
// operation 2 FETCH
// operation 3 CONCAT
// operation 4 COMPRESS (Brotli)
// operation 5 ENCODE (Base64)
```

but actually 3,4,5 are what we can call a processing step.

fetch u8 -> process specifics -> format for HtmlDoc

We successfully implemented this fetch and process pipeline. It's a lot more organized but it still feels a little bit N style. This is due to my own inability to solve the problem elegantly. I feel like I am beginning to see the shape of how I would like to solve it but I'm not able to write it out. Might be time to draw some diagrams with arrows on a white board.

Nevertheless, we move on. Implementing one path for the wasm. This is essential for the compilation step. Hmm this is more complicatd than I thought. 

Say you want to use remote wasm modules. It would already have to be compiled, and you would need to link both the glue and the binary. We can do this already. However, if we want a single path for local then we remove this functionality? Idea, have a source and have a path.

Idea: rather than having remote vs local, have a function determine if its a url or not. Makes the config file simpler.

Build Cache is up next, is this an essential feature? I mean if you want fast iteration you don't want to be brotli compressing everytime, it takes a few seconds so why not make the process more streamlined. We also don't want to always make http requests. We have the HtmlDoc already built and pre processed. How do we cache it? Or rather the parts of it. A simple date time checker? Save each struct in a way that can easily be loaded? The only things you need to cache are the wasm module to brotli + base64 and the http requests. Why save anything else? It should already be on disk.

What does an API look like for this program?

How would an LLM use this tool most effectively?

Errors

so I read this https://www.howtocodeit.com/guides/the-definitive-guide-to-rust-error-handling

I understand dynamic vs structured errors. This library should be structured and enumd. We have done something similar in the past with another Rust project. The difference here is that Histos is an API that can be consumed by multiple users, CLI or directly as a Crate. 

-> API error 
    -> programmatically handleable
        -> Cli error message, human readable

What are some fundamental error types. We can figure this out from what the failure modes are. Input/Output (config, fileio), network (fetch), encoding

CONFIG
COMPILE
FETCH
PROCESS
PACK

Config
I feel a lot is already handled by the configuration parser. Fields are missing that need to be there? malformed fields, like url/filepath is just some mumbo jumbo. but these errors propagate upwards to fetch step. 

Compile, missing wasm-pack. fails to compile. multi threading failures.

Fetch, there are many different network failures and fileio errors. file not found from path, invalid permissions to read?, network not working, dns, connection timeout, http error codes, response sizes, invalid response body. local vs remote. 

Encode, somehow doesn't encode to brotli? or base64? why would this ever fail? file to large? stalls? corrupted input/outputs? out of memory?

Save, overwriting existing file permissions? out of memory, out of disk space. 

so user (config), environment (network/local) and internal errors are possible

Now let's look at our current code error structure. 

unwrap_or_default() all over config.rs

load_config() might fail at Io of and then serde of yaml.

build() 
compile

fetcher()
process error Into:into
encoder failure
local
remote

save to file output html

why not do a simple style of building out one full simple error? like not enough space on disk or whatever in save to file

## cleanup up for v0.0.1
Used claude code to speed up three finalizing tasks: implementing the error suite I designed, from `Box dyn Error` to `HistosResult`, making as test suite, and commenting # Errors and # Examples for the documentation. 


woo we released 0.0.1

been working on this for a year now, super proud. now time to test it out in some workflows as part of a build pipeline!
