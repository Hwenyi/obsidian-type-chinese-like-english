import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface ConverterSetting {
    baseURL: string;
    model: string;
    apiKey: string;
    withContext: boolean;
}

const DEFAULT_SETTINGS: ConverterSetting = {
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: '',
    withContext: false
}

export default class PinyinConverter extends Plugin {
    settings: ConverterSetting;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'convert-to-characters-math',
            name: '转换为汉字和mathjax',
            hotkeys: [{ modifiers: ["Alt"], key: 'i' }],
            editorCallback: (editor: Editor) => {
                this.convertToCharacters(editor);
            }
        });

        this.addSettingTab(new PinyinConverterSettingTab(this.app, this));
    }

    getEditor() {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
            return mdView.editor;
        }
        return null;
    }

    async convertToCharacters(editor: Editor) {
        // 获取当前行信息
        const cursor = editor.getCursor();
        const currentLine = cursor.line;
        const lineContent = editor.getLine(currentLine);

        if (!lineContent.trim()) {
            new Notice('当前行没有文本可转换', 3000);
            return;
        }

        const loadingNotice = new Notice('正在转换拼音...', 0);

        try {
            let contextContent = '';
            if (this.settings.withContext) {
                // 获取文档上下文
                const fullContent = editor.getValue();
                const lines = fullContent.split('\n');
                lines[currentLine] = `[待转换行] ${lines[currentLine]}`;
                contextContent = lines.join('\n');

				if(contextContent.length > 2000) {
					const start = Math.max(currentLine - 10, 0);
					const end = Math.min(currentLine + 10, lines.length-1);
					contextContent = lines.slice(start, end).join('\n');
					if(contextContent.length > 2000) {
						contextContent = contextContent.substring(0, 2000);
					}
				}

            }

            const convertedText = await this.callAPI(lineContent, contextContent);

            if (convertedText) {
                // 删除当前行内容
                editor.setLine(currentLine, '');
                
                // 将光标移动到行首
                editor.setCursor({
                    line: currentLine,
                    ch: 0
                });

                // 在当前位置插入转换后的文本
                editor.replaceRange(convertedText.trim(), {
                    line: currentLine,
                    ch: 0
                });

                new Notice('转换完成！', 2000);
            } else {
                throw new Error('API返回的结果为空');
            }
        } catch (error) {
            console.error('Conversion error:', error);
            new Notice(`转换失败: ${error instanceof Error ? error.message : '未知错误'}`, 5000);
        } finally {
            loadingNotice.hide();
        }
    }

	async callAPI(input: string, context = ''): Promise<string> {
	const systemPrompt = `
	**1. R (Role):** 你是一位专业的数学公式翻译助手和中文拼音翻译助手，能够将包含拼音、英文以及自然语言描述的数学公式的混合文本转换成流畅、准确的中文语句，并使用 MathJax 语法表达其中的数学公式。
	**2. O (Objectives):**
	*   将用户提供的拼音和英文混合文本转换成相应的中文语句，力求表达流畅、准确，忠于原文意思，不进行解释、曲解、大幅度修改或扩写。
	*   将用户使用自然语言描述的数学公式（例如：“x 的平方”，“y 对 x 的积分”）转换成对应的 MathJax 格式。
	*   识别并修复用户可能因输入过快导致的个别拼音或单词的字母顺序颠倒、错乱（例如 “shang” 输入为 “shagn”）。
	**3. S (Style):** 自然流畅，符合现代中文表达习惯，避免口语化或过于正式。数学公式使用清晰、准确的 MathJax 语法。
	**4. C (Content):**  用户输入的文本模拟了在中文输入法下只输入拼音和英文的场景，目的是为了减少 IME 选词干扰，保持思路流畅，尤其是在输入数学公式时。你需要理解这种输入方式背后的需求和**实际文本的上下文内容**，并尽可能准确地还原用户想要表达的意思，包括正确理解并转换自然语言描述的数学公式。
	**5. I (Input):**
	*   包含拼音、英文单词以及自然语言描述的数学公式的混合文本字符串。
	*   拼音之间可能存在空格或因用户不想中断思路而连接在一起。
	*   英文单词通常完整拼写。
	*   自然语言描述的数学公式可能包括中文的运算符号、函数名等。
	*   同时，提供了整个上下文作为参考，更好地了解输入者的表达意图。
	**6. R (Response):**
	*   转换后的完整中文语句，确保语句通顺，意思表达清晰。
	*   使用 MathJax 语法表示所有识别出的数学公式。
	*   保留所有其他的格式标记，如 Markdown 格式标记、Obsidian 的链接、Wiki 链接、图片链接等。
	**7. A (Audience):** 所有需要将拼音、英文以及自然语言描述的数学公式的混合文本转换成中文和 MathJax 公式的用户。
	**8. W (Workflow):**
	1. 识别输入文本中的拼音、英文单词和自然语言描述的数学公式。
	2. 将拼音转换成对应的汉字，并**根据上下文**选择最合适的词义。
	3. 将英文单词融入中文语句中，确保语义流畅自然。
	4. 将自然语言描述的数学公式转换成对应的 MathJax 语法。
	5. 用户可能因为输入过快，导致个别拼音或者单词的字母顺序出现了颠倒、错乱，比如 shang，输入为了 shagn，你应该结合上下文正确识别到这些错误，并正确地修复它。
	6. 整合所有部分，生成最终的中文语句和 MathJax 公式。
	7. 严禁解释、曲解，大幅度修改，扩写内容！不需要输出额外的说明，你只负责转换！！！
	**示例:**
	**Input (输入):** zhe ge function shi fxdnegyu x de pingfang ,  its derivative is fx shi 2x ,zheshi chagn yong [[qiudaogongshi]]
	**Response (响应):** 这个 function 是 $f(x) = x^2$, 它的微分是 $f'(x) = 2x$，这是常用[[求导公式]]
	**Input:** ruguo wo dui y dengyu x fen zhi yi jinxing jifen,  jieguo shi shenme?
	**Response (响应):** 如果我对 $y = \frac{1}{x}$ 进行积分，结果是什么？
	**Input:** jisuan y dengyu e de x cifang zai qujian 0 dao 1 shang de dingjifen
	**Response (响应):** 计算 $y = e^x$ 在区间 $[0, 1]$ 上的定积分。
	**Input:** y dui x de er jie daoshu keyi xiecheng shenmeyang?
	**Response (响应):** $y$ 对 $x$ 的二阶导数可以写成什么样？
	**Input:** zhe shi yiduan ceshi wenben , duoge pinyin zhijian keneng hunhezaiyiqi yekeneng fenkaile, ruguo meiyoufenkai shiyinweiyonghu xianzai buxiangbeiganraodaduan, siluhenshunchang
	**Response:** 这是一段测试文本，多个拼音之间可能混合在一起也可能分开了，如果没有分开，是因为用户现在不想被干扰打断，思路很顺畅
	**Input:** sometimes zhijie yong yingwen word keyi genghao de chuanda wode feeling
	**Response:** 有时候直接用英文单词可以更好地传达我的感受
	**Input:** jintian tianze henhao,  very sunny,  shi he wai chu de rizi
	**Response:** 今天天色很好，very sunny，适合外出的日子。
	`;
		try {
			let userPrompt = '';
			if (context) {
				userPrompt = `下面当前输入的完整上下文，你要结合上下文充分了解输入者的表达意图和具体的场景，把拼音转化为和上下文内容主题一致的、正确的词语表达：
	${context}
	转换下列段落, 纠正错误输入和误拼, 直接输出转换结果: 
	${input}`;
			} else {
				userPrompt = `转换下列段落, 纠正错误输入和误拼, 直接输出转换结果: 
	${input}`;
			}

			const response = await fetch(`${this.settings.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.settings.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: this.settings.model,
					messages: [
						{
							role: "system",
							content: systemPrompt
						},
						{
							role: "user",
							content: userPrompt
						}
					],
					stream: false,
					max_tokens: 4096,
					temperature: 0.5,
					top_p: 0.7
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => null);
				throw new Error(
					errorData?.error?.message || 
					`API请求失败 (HTTP ${response.status})`
				);
			}

			const data = await response.json();
			
			if (!data.choices?.[0]?.message?.content) {
				throw new Error('API返回的数据格式不正确');
			}

			return data.choices[0].message.content.trim();

		} catch (error) {
			console.error('API Error:', error);
			if (error instanceof Error) {
				if (error.message.includes('Failed to fetch')) {
					throw new Error(`无法连接到API服务器 (${this.settings.baseURL})`);
				}
				throw error;
			}
			throw new Error('调用API时发生未知错误');
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

        containerEl.createEl('h2', {text: '拼音转换设置'});

        new Setting(containerEl)
            .setName('模型')
            .setDesc('用于转换的默认模型')
            .addText(text => text
                .setPlaceholder('Qwen/Qwen2.5-7B-Instruct')
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('API地址')
            .setDesc('API服务器地址，例如: https://api.siliconflow.cn/v1 (注意：/v1不能省略)')
            .addText(text => text
                .setPlaceholder('https://api.siliconflow.cn/v1')
                .setValue(this.plugin.settings.baseURL)
                .onChange(async (value) => {
                    this.plugin.settings.baseURL = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('API密钥')
            .setDesc('一般是sk-')
            .addText(text => text
                .setPlaceholder('')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('是否包含笔记上下文')
            .setDesc('将会消耗稍多的token，以及稍慢的响应时间，但可能有更好的转换效果')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.withContext)
                .onChange(async (value) => {
                    this.plugin.settings.withContext = value;
                    await this.plugin.saveSettings();
            }));
    }
}