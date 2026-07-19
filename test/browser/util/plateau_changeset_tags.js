describe('utilApplyPlateauSourceTags', () => {
  const REF = 'https://wiki.openstreetmap.org/wiki/MLIT_PLATEAU/imports_outline';

  it('names both the data source and the tool', () => {
    const sources = new Set();
    const tags = {};
    Rapid.utilApplyPlateauSourceTags(sources, tags);

    // MLIT_PLATEAU is what the parent import convention asks for (the data's
    // origin); RapiD_Plateau_JP identifies the tool that made the edit.
    expect([...sources]).to.eql(['MLIT_PLATEAU', 'RapiD_Plateau_JP']);
  });

  it('sets source_ref to the import outline the convention pairs with the source', () => {
    const sources = new Set();
    const tags = {};
    Rapid.utilApplyPlateauSourceTags(sources, tags);
    expect(tags.source_ref).to.equal(REF);
  });

  it('keeps source values the user typed', () => {
    const sources = new Set(['survey']);
    const tags = {};
    Rapid.utilApplyPlateauSourceTags(sources, tags);
    expect([...sources]).to.include('survey');
  });

  it('is idempotent — the commit panel re-renders and calls this repeatedly', () => {
    const sources = new Set();
    const tags = {};
    Rapid.utilApplyPlateauSourceTags(sources, tags);
    Rapid.utilApplyPlateauSourceTags(sources, tags);
    Rapid.utilApplyPlateauSourceTags(sources, tags);

    expect([...sources]).to.eql(['MLIT_PLATEAU', 'RapiD_Plateau_JP']);
    expect(tags.source_ref).to.equal(REF);
  });

  it('does not clobber a source_ref the user set themselves', () => {
    const sources = new Set();
    const tags = { source_ref: 'https://example.com/my-own-note' };
    Rapid.utilApplyPlateauSourceTags(sources, tags);
    expect(tags.source_ref).to.equal('https://example.com/my-own-note');
  });

  // The commit panel recomputes these tags on every render. If the user applies a
  // Plateau transfer and then undoes it, our source_ref has to go away too --
  // otherwise the changeset claims a provenance the edit no longer has.
  it('clears our own source_ref once Plateau data is no longer used', () => {
    const tags = {};
    Rapid.utilApplyPlateauSourceTags(new Set(), tags);
    expect(tags.source_ref).to.equal(REF);

    Rapid.utilClearPlateauSourceRef(tags);
    expect(tags.source_ref).to.equal(undefined);
  });

  it('leaves a user-set source_ref alone when clearing', () => {
    const tags = { source_ref: 'https://example.com/my-own-note' };
    Rapid.utilClearPlateauSourceRef(tags);
    expect(tags.source_ref).to.equal('https://example.com/my-own-note');
  });
});
