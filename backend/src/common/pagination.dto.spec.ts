import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageQueryDto } from './pagination.dto';

describe('PageQueryDto', () => {
  it('transforms numeric paging inputs and the explicit false flag', async () => {
    const dto = plainToInstance(PageQueryDto, { page: '2', pageSize: '25', dispensed: 'false', q: 'CBC' });
    expect(dto).toMatchObject({ page: 2, pageSize: 25, dispensed: false, q: 'CBC' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects out-of-range paging and non-boolean dispense filters', async () => {
    const dto = plainToInstance(PageQueryDto, { page: '0', pageSize: '101', dispensed: 'sometimes' });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['page', 'pageSize', 'dispensed']));
  });
});
