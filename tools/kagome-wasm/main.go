//go:build js && wasm

package main

import (
	"strings"
	"syscall/js"

	"github.com/ikawaha/kagome-dict/uni"
	"github.com/ikawaha/kagome/v2/tokenizer"
)

var kagome *tokenizer.Tokenizer

func tokenize(_ js.Value, args []js.Value) any {
	if len(args) == 0 || kagome == nil {
		return nil
	}

	tokens := kagome.Tokenize(args[0].String())
	result := make([]any, 0, len(tokens))
	for _, token := range tokens {
		result = append(result, map[string]any{
			"surface": token.Surface,
			"pos":     strings.Join(token.POS(), ","),
		})
	}
	return result
}

func main() {
	var err error
	kagome, err = tokenizer.New(uni.Dict(), tokenizer.OmitBosEos())
	if err != nil {
		panic(err)
	}

	js.Global().Set("kagome_tokenize", js.FuncOf(tokenize))
	js.Global().Set("kagome_ready", true)
	<-make(chan struct{})
}
