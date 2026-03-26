/* LanguageTool, a natural language style checker
 * Copyright (C) 2016 Daniel Naber (http://www.danielnaber.de)
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301
 * USA
 */
package org.languagetool.server;

import org.junit.Ignore;
import org.junit.Test;
import org.languagetool.DetectedLanguage;
import org.languagetool.markup.AnnotatedTextBuilder;

import java.io.*;
import java.util.*;

import static org.hamcrest.core.Is.is;
import static org.junit.Assert.*;

public class TextCheckerTest {

  private final TextChecker checker = new V2TextChecker(new HTTPServerConfig(), false, null, new RequestCounter());

  @Test
  public void testJSONP() throws Exception {
    Map<String, String> params = new HashMap<>();
    params.put("text", "not used");
    params.put("language", "pt-BR");
    params.put("callback", "myCallback");
    HTTPServerConfig config1 = new HTTPServerConfig(HTTPTestTools.getDefaultPort());
    TextChecker checker = new V2TextChecker(config1, false, null, new RequestCounter());
    FakeHttpExchange httpExchange = new FakeHttpExchange();
    checker.checkText(new AnnotatedTextBuilder().addText("some random text").build(), httpExchange, params, null, null);
    assertTrue(httpExchange.getOutput().startsWith("myCallback("));
    assertTrue(httpExchange.getOutput().endsWith(");"));
  }
  
  @Test
  public void testMaxTextLength() throws Exception {
    Map<String, String> params = new HashMap<>();
    params.put("text", "not used");
    params.put("language", "pt-BR");
    HTTPServerConfig config1 = new HTTPServerConfig(HTTPTestTools.getDefaultPort());
    config1.setMaxTextLengthAnonymous(10);
    TextChecker checker = new V2TextChecker(config1, false, null, new RequestCounter());
    try {
      checker.checkText(new AnnotatedTextBuilder().addText("longer than 10 chars").build(), new FakeHttpExchange(), params, null, null);
      fail();
    } catch (TextTooLongException ignore) {}
    try {
      params.put("token", "invalid");
      checker.checkText(new AnnotatedTextBuilder().addText("longer than 10 chars").build(), new FakeHttpExchange(), params, null, null);
      fail();
    } catch (RuntimeException ignore) {}
    String validToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczpcL1wvbGFuZ3VhZ2V0b29scGx1cy5jb20iLCJpYXQiOjE1MDQ4NTY4NTQsInVpZCI6MSwibWF4VGV4dExlbmd0aCI6MTAwfQ._-8qpa99IWJiP_Zx5o-yVU11neW8lrxmLym1DdwPtIc";
    try {
      params.put("token", validToken);
      checker.checkText(new AnnotatedTextBuilder().addText("longer than 10 chars").build(), new FakeHttpExchange(), params, null, null);
      fail();
    } catch (RuntimeException expected) {
      // server not configured to accept tokens
    }

    try {
      checker.checkText(new AnnotatedTextBuilder().addText("now it's even longer than 30 chars").build(), new FakeHttpExchange(), params, null, null);
      fail();
    } catch (TextTooLongException expected) {
      // too long even with claim from token, which allows 30 characters
    }
  }
  
  @Test
  public void testUnsupportedMultilingualParameters() throws Exception {
    Map<String, String> params = new HashMap<>();
    params.put("text", "not used");
    params.put("language", "pt-BR");
    HTTPServerConfig config1 = new HTTPServerConfig(HTTPTestTools.getDefaultPort());
    TextChecker checker = new V2TextChecker(config1, false, null, new RequestCounter());
    for (String paramName : Arrays.asList("altLanguages", "preferredLanguages", "preferredVariants", "noopLanguages", "motherTongue", "multilingual")) {
      params.clear();
      params.put("text", "not used");
      params.put("language", "pt-BR");
      params.put(paramName, "pt-BR");
      try {
        checker.checkText(new AnnotatedTextBuilder().addText("something").build(), new FakeHttpExchange(), params, null, null);
        fail(paramName + " should not be accepted");
      } catch (BadRequestException ignore) {
      }
    }
  }

  @Test
  public void testBrazilianPortugueseAlias() {
    assertThat(TextChecker.parseLanguage("pt").getShortCodeWithCountryAndVariant(), is("pt-BR"));
    assertThat(TextChecker.parseLanguage("pt-BR").getShortCodeWithCountryAndVariant(), is("pt-BR"));
  }

  @Test
  public void testLanguageDefaultsToBrazilianPortuguese() {
    V2TextChecker checker = new V2TextChecker(new HTTPServerConfig(), false, null, new RequestCounter());
    DetectedLanguage language = checker.getLanguage("qualquer texto", Collections.emptyMap(), Collections.emptyList(), Collections.emptyList(), Collections.emptyList(), false);
    assertThat(language.getGivenLanguage().getShortCodeWithCountryAndVariant(), is("pt-BR"));
    assertThat(language.getDetectedLanguage().getShortCodeWithCountryAndVariant(), is("pt-BR"));
  }

  @Test(expected = BadRequestException.class)
  public void testOnlyBrazilianPortugueseIsAccepted() {
    TextChecker.parsePortugueseBrazilLanguage("en-US");
  }

}
