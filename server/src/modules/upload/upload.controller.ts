import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UploadService, type UploadedFileLike } from './upload.service';

@ApiTags('upload')
@ApiBearerAuth()
@Controller('upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '上传图片/营业执照（MVP 落本地磁盘）',
    description: '字段名 file，≤10MB，类型限 jpg / png / webp / pdf，返回 /uploads/... 访问路径',
  })
  uploadFile(@UploadedFile() file: UploadedFileLike) {
    return this.upload.save(file);
  }
}
