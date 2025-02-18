import { App, Editor, Notice,MarkdownView, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createGroq } from '@ai-sdk/groq';

interface ConverterSetting {
	withContext: boolean;
	withLaTeX: boolean;
	model: string;
	apiKey: string;
	baseUrl: string
}

const DEFAULT_SETTINGS: ConverterSetting = {
	withContext: false,
	withLaTeX: false,
	model: "llama-3.3-70b-versatile",
	apiKey: "",
	baseUrl: "https://api.groq.com/openai/v1"

}

export default class PinyinConverter extends Plugin {

    settings: ConverterSetting;

    async onload() {

        await this.loadSettings();

        this.addCommand({
            id: 'convert-to-characters-math',
            name: '转换为汉字和LaTex',
            editorCallback: (editor: Editor) => {
                this.convertToCharacters(editor);
            }
        });

        this.addSettingTab(new PinyinConverterSettingTab(this.app, this));
    }

	getContext(editor: Editor): string {
		const cursor = editor.getCursor();
		const startLine = Math.max(0, cursor.line - 3);
		let contextText = "";
		for (let i = startLine; i < cursor.line; i++) {
			contextText += editor.getLine(i) + "\n";
		}
		if (contextText.length > 1000) {
			contextText = contextText.substring(0, 1000);
		}
		return contextText;
	}

    /**
     * 将光标所在行转换为汉字和LaTeX，根据设置决定是否包含上下文以及使用普通或LaTeX模式
     */
    async convertToCharacters(editor: Editor): Promise<void> {
        const cursor = editor.getCursor();
        const inputLine = editor.getLine(cursor.line).trim();
        if (!inputLine) {
            new Notice("当前所在行为空");
            return;
        }
        const context = this.settings.withContext ? this.getContext(editor) : "";
        const result = await this.callAPI(inputLine, context);
        if (result) {
            // 将当前行替换为转换结果
            const lineStart = { line: cursor.line, ch: 0 };
            const lineEnd = { line: cursor.line, ch: inputLine.length };
            editor.replaceRange(result, lineStart, lineEnd);
            new Notice("转换完成");
        } else {
            new Notice("转换失败");
        }
    }


	normalPrompt = `你要将用户的<待转换拼音>拼写为正确的中文，输出过程分为五步，将以json格式逐步打印每一步的输出结果：
step1：将用户的拼音分词拆分为有意义、能拼写的逐个汉字拼音，每个汉字拼音用空格分隔。
step2：根据第一步的拼音分词结果，先分析原句，指出并修复用户可能存在的拼音拼写错误，然后结合第一步的输出结果，输出每个拼音标注声调后的结果
step3：根据第二步的输出结果，逐字拼写为中文句子
step4：根据第三步和第二步的结果，分析是否可能存在拼音分词、拼音拼写等错误，拼写的各个汉字在句子中是否具有合理、正确的意义，指出疑点和不通顺的地方
step5：这是最后一步，根据第三步的初步结果和第四步的疑点分析，修正可能有误的单词拼写，将用户输入的中文拼音在尊重保留原义的基础上拼写为正确、流畅的中文，给出最终拼写结果。
`

	mathPrompt = `你要将用户的<待转换拼音>拼写为正确的中文，自然语言描述的数学表达式转换为规范的 MathJax 语法渲染，输出过程分为七步，将以 json 格式逐步打印每一步的输出结果：
step1：保留尊重原文所有语义，将用户的拼音分词拆分为有意义、能拼写的逐个汉字拼音，每个汉字拼音用空格分隔。
step2：根据第一步的拼音分词结果，先分析原句，指出并修复用户可能存在的拼音拼写错误，然后结合第一步的输出结果，输出每个拼音标注声调后的结果
step3：根据第二步的输出结果，逐字拼写为中文句子
step4：根据第三步和第二步的结果，分析是否可能存在拼音分词、拼音拼写等错误，拼写的各个汉字在句子中是否具有合理、正确的意义，指出疑点和不通顺的地方
step5：根据第三步的初步结果和第四步的疑点分析，修正可能有误的单词拼写，将用户输入的中文拼音在保留尊重原文所有语义的基础上拼写为正确的中文句子，给出最终拼写结果。
step6：根据第五步的中文自然语言拼写结果，提取其中所有自然语言描述的数学表达式部分（以format1、format2 ... 枚举），然后以 MathJax 语法格式($)重写为可渲染的表达式
step7：结合第五步和第六步的输出结果，将第五步的结果里中文描述的数学表达式用第六步中的 MathJax 表达替换，给出最终结果，严禁对结果进行作答、解释，说明，输出额外内容，仅进行转写，使得整体上呈现为理工科教科书的语言、排版风格
`

	normalSchema = z.object({
		step1: z.object({
			output: z.string()
		}),
		step2: z.object({
			analysis: z.string(),
			output: z.string()
		}),
		step3: z.object({
			output: z.string()
		}),
		step4: z.object({
			analysis: z.string()
		}),
		step5: z.object({
			analysis: z.string(),
			output: z.string()
		})
	})

	mathSchema = z.object({
		step1: z.object({
			output: z.string()
		}),
		step2: z.object({
			analysis: z.string(),
			output: z.string()
		}),
		step3: z.object({
			output: z.string()
		}),
		step4: z.object({
			analysis: z.string()
		}),
		step5: z.object({
			output: z.string()
		}),
		step6: z.object({
			format1: z.object({
				origin: z.string(),
				mathjax: z.string()
			}).describe("format1, format2 ... and so on")
		}),
		step7: z.object({
			output: z.string()
		})
	})


    async callAPI(input: string, context: string = ""): Promise<string> {
        
		const isMathMode = this.settings.withLaTeX;
        const systemPrompt = isMathMode ? this.mathPrompt : this.normalPrompt;
		const system = this.settings.withContext ? `${systemPrompt} \n <参考上下文> 帮助分析句义，不参与最终转换过程` : systemPrompt;
		const prompt = context ? `<参考上下文>${context}<参考上下文/>\n<待转换拼音>${input}<待转换拼音/>` : `<待转换拼音>input<待转换拼音/>`;
		const model = this.settings.model;
        
        const openai = createGroq({
            baseURL: this.settings.baseUrl,
            apiKey: this.settings.apiKey,
        })

		try {

			if (isMathMode) {

				const { object } = await generateObject({
					model: openai(model), 
					schema: this.mathSchema,
					temperature: 0.5,
					system,
					prompt
				});

				return object.step7.output;

		} else {

			const { object } = await generateObject({
				model: openai(model), 
				schema: this.normalSchema,
				temperature: 0.5,
				system,
				prompt
			});

			return object.step5.output;
		}

		} catch (error) {
			console.error(error);
			new Notice("转换失败，请检查设置和控制台日志");
			return "";
		}

    }

	async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class PinyinConverterSettingTab extends PluginSettingTab {

    plugin: PinyinConverter;

    constructor(app: App, plugin: PinyinConverter) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

		// 设置：是否包含笔记上下文
        new Setting(containerEl)
            .setName('包含笔记上下文')
            .setDesc('消耗更多 tokens 以及稍慢响应，但可能有更好的转换效果')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.withContext)
                    .onChange(async (value) => {
                        this.plugin.settings.withContext = value;
                        await this.plugin.saveSettings();
                    })
            );

        // 设置：是否使用 LaTeX 模式
        new Setting(containerEl)
            .setName('使用 LaTeX 模式')
            .setDesc('自然语言描述的数学表达式转换为 LaTex，和包含上下文同时开启可能引起不必要的输出')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.withLaTeX)
                    .onChange(async (value) => {
                        this.plugin.settings.withLaTeX = value;
                        await this.plugin.saveSettings();
                    })
            );

        // 设置：API Base URL
        new Setting(containerEl)
            .setName('API Base URL')
            .setDesc('建议注册免费的groq，必须携带v1，例如：https://api.groq.com/openai/v1')
            .addText(text =>
                text
                    .setPlaceholder('https://api.groq.com/openai/v1')
                    .setValue(this.plugin.settings.baseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.baseUrl = value;
                        await this.plugin.saveSettings();
                    })
            );

        // 设置：Model
        new Setting(containerEl)
            .setName('模型')
            .setDesc('尽量使用可以结构化输出的模型，例如：llama-3.3-70b-versatile')
            .addText(text =>
                text
                    .setPlaceholder('请输入模型名称')
                    .setValue(this.plugin.settings.model)
                    .onChange(async (value) => {
                        this.plugin.settings.model = value;
                        await this.plugin.saveSettings();
                    })
            );

        // 设置：API Key
        new Setting(containerEl)
            .setName('API Key')
            .setDesc('用于调用 API 的密钥')
            .addText(text =>
                text
                    .setPlaceholder('请输入 API Key')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}


